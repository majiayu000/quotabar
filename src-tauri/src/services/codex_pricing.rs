use serde::Deserialize;
use std::{collections::HashMap, fs, path::PathBuf};

#[derive(Debug, Clone)]
pub struct CodexPriorityPricingPolicy {
    models: HashMap<String, LiteLlmModelPricing>,
}

#[derive(Debug, Clone, Copy)]
pub struct CodexTokenUsage {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_tokens: i64,
    pub cache_read_tokens: i64,
}

#[derive(Debug, Clone, Copy)]
struct CodexPriorityPricing {
    input: f64,
    output: f64,
    cache_read: f64,
    regional_multiplier: f64,
}

#[derive(Debug, Clone, Deserialize)]
struct LiteLlmModelPricing {
    input_cost_per_token_priority: Option<f64>,
    output_cost_per_token_priority: Option<f64>,
    cache_read_input_token_cost_priority: Option<f64>,
    regional_processing_uplift_multiplier_us: Option<f64>,
}

impl CodexPriorityPricingPolicy {
    pub fn load_from_default_cache() -> Result<Self, String> {
        Self::load_from_cache_paths(pricing_cache_candidate_paths()?)
    }

    fn load_from_cache_paths(paths: Vec<PathBuf>) -> Result<Self, String> {
        let mut checked_paths = Vec::with_capacity(paths.len());
        for path in paths {
            checked_paths.push(path.display().to_string());
            match fs::read_to_string(&path) {
                Ok(content) => {
                    return Self::from_litellm_json_str(&content)
                        .map_err(|err| format!("{err} at {}", path.display()));
                }
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
                Err(err) => {
                    return Err(format!(
                        "Failed to read ccstats pricing cache at {}: {err}",
                        path.display()
                    ));
                }
            }
        }

        Err(format!(
            "Failed to read ccstats pricing cache; checked {}",
            checked_paths.join(", ")
        ))
    }

    pub(crate) fn from_litellm_json_str(content: &str) -> Result<Self, String> {
        let raw: HashMap<String, LiteLlmModelPricing> = serde_json::from_str(content)
            .map_err(|err| format!("Failed to parse ccstats pricing cache: {err}"))?;
        let models = raw
            .into_iter()
            .map(|(model, pricing)| (normalize_model_key(&model), pricing))
            .collect();

        Ok(Self { models })
    }

    pub fn calculate_us_priority_cost(
        &self,
        model: &str,
        usage: CodexTokenUsage,
    ) -> Result<Option<f64>, String> {
        validate_tokens(model, usage)?;

        let Some(pricing) = self.priority_pricing(model)? else {
            return Ok(None);
        };
        let output_tokens = usage.output_tokens + usage.reasoning_tokens;
        let cost = (usage.input_tokens as f64 * pricing.input
            + output_tokens as f64 * pricing.output
            + usage.cache_read_tokens as f64 * pricing.cache_read)
            * pricing.regional_multiplier;

        Ok(Some(cost))
    }

    fn priority_pricing(&self, model: &str) -> Result<Option<CodexPriorityPricing>, String> {
        let requires_policy = requires_codex_priority_policy(model);
        let Some(entry) = self.lookup_model(model) else {
            if requires_policy {
                return Err(format!(
                    "ccstats pricing cache is missing Codex priority pricing for {model}"
                ));
            }
            return Ok(None);
        };

        match priority_pricing_from_entry(model, entry) {
            Ok(pricing) => Ok(Some(pricing)),
            Err(err) if requires_policy => Err(err),
            Err(_) => Ok(None),
        }
    }

    fn lookup_model(&self, model: &str) -> Option<&LiteLlmModelPricing> {
        for key in model_lookup_keys(model) {
            if let Some(pricing) = self.models.get(&key) {
                return Some(pricing);
            }
        }
        None
    }
}

fn priority_pricing_from_entry(
    model: &str,
    entry: &LiteLlmModelPricing,
) -> Result<CodexPriorityPricing, String> {
    Ok(CodexPriorityPricing {
        input: required_field(
            model,
            "input_cost_per_token_priority",
            entry.input_cost_per_token_priority,
        )?,
        output: required_field(
            model,
            "output_cost_per_token_priority",
            entry.output_cost_per_token_priority,
        )?,
        cache_read: required_field(
            model,
            "cache_read_input_token_cost_priority",
            entry.cache_read_input_token_cost_priority,
        )?,
        regional_multiplier: required_field(
            model,
            "regional_processing_uplift_multiplier_us",
            entry.regional_processing_uplift_multiplier_us,
        )?,
    })
}

fn required_field(model: &str, field: &str, value: Option<f64>) -> Result<f64, String> {
    value.ok_or_else(|| format!("ccstats pricing cache is missing {field} for {model}"))
}

fn validate_tokens(model: &str, usage: CodexTokenUsage) -> Result<(), String> {
    if usage.input_tokens < 0
        || usage.output_tokens < 0
        || usage.reasoning_tokens < 0
        || usage.cache_read_tokens < 0
    {
        return Err(format!(
            "Codex token usage for {model} contains negative values"
        ));
    }

    Ok(())
}

fn model_lookup_keys(model: &str) -> Vec<String> {
    let normalized = normalize_model_key(model);
    let mut keys = vec![normalized.clone()];
    if let Some(stripped) = normalized.strip_prefix("openai/") {
        keys.push(stripped.to_string());
    }
    keys
}

fn requires_codex_priority_policy(model: &str) -> bool {
    matches!(
        normalize_openai_model_key(model).as_str(),
        "gpt-5.4" | "gpt-5.4-2026-03-05" | "gpt-5.5" | "gpt-5.5-2026-04-23"
    )
}

fn normalize_openai_model_key(model: &str) -> String {
    let normalized = normalize_model_key(model);
    normalized
        .strip_prefix("openai/")
        .unwrap_or(&normalized)
        .to_string()
}

fn normalize_model_key(model: &str) -> String {
    model.trim().to_ascii_lowercase()
}

fn pricing_cache_candidate_paths() -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::new();
    if let Some(home) = dirs::home_dir() {
        paths.push(home.join(".cache").join("ccstats").join("pricing.json"));
    }
    if let Some(cache_dir) = dirs::cache_dir() {
        paths.push(cache_dir.join("ccstats").join("pricing.json"));
    }
    paths.dedup();

    if paths.is_empty() {
        return Err("Failed to resolve ccstats pricing cache directory".to_string());
    }

    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRICING_FIXTURE: &str = r#"{
      "gpt-5.5": {
        "input_cost_per_token_priority": 0.00001,
        "output_cost_per_token_priority": 0.00006,
        "cache_read_input_token_cost_priority": 0.000001,
        "regional_processing_uplift_multiplier_us": 1.1
      },
      "other-model": {
        "input_cost_per_token": 0.00001
      }
    }"#;

    #[test]
    fn calculates_priority_regional_cost_from_pricing_cache() {
        let policy = parse_policy(PRICING_FIXTURE);
        let cost = match policy.calculate_us_priority_cost(
            "gpt-5.5",
            CodexTokenUsage {
                input_tokens: 1_000_000,
                output_tokens: 2_000_000,
                reasoning_tokens: 3_000_000,
                cache_read_tokens: 4_000_000,
            },
        ) {
            Ok(Some(cost)) => cost,
            Ok(None) => panic!("gpt-5.5 should have priority pricing"),
            Err(err) => panic!("cost should calculate: {err}"),
        };

        assert!((cost - 345.4).abs() < 0.001);
    }

    #[test]
    fn errors_when_required_codex_priority_fields_are_missing() {
        let policy = parse_policy(r#"{"gpt-5.5": {}}"#);
        let err = match policy.calculate_us_priority_cost(
            "gpt-5.5",
            CodexTokenUsage {
                input_tokens: 1,
                output_tokens: 1,
                reasoning_tokens: 0,
                cache_read_tokens: 0,
            },
        ) {
            Ok(_) => panic!("missing required Codex priority fields should fail"),
            Err(err) => err,
        };

        assert!(err.contains("input_cost_per_token_priority"));
    }

    #[test]
    fn ignores_unknown_models_without_priority_policy() {
        let policy = parse_policy(PRICING_FIXTURE);
        let cost = match policy.calculate_us_priority_cost(
            "other-model",
            CodexTokenUsage {
                input_tokens: 1,
                output_tokens: 1,
                reasoning_tokens: 0,
                cache_read_tokens: 0,
            },
        ) {
            Ok(cost) => cost,
            Err(err) => panic!("unknown model should not fail: {err}"),
        };

        assert_eq!(cost, None);
    }

    #[test]
    fn loads_first_existing_pricing_cache_path() {
        let base = std::env::temp_dir().join(format!(
            "quotabar-codex-pricing-test-{}",
            std::process::id()
        ));
        let missing = base.join("missing").join("pricing.json");
        let existing = base.join("existing").join("pricing.json");
        if let Some(parent) = existing.parent() {
            if let Err(err) = fs::create_dir_all(parent) {
                panic!("failed to create test pricing cache directory: {err}");
            }
        }
        if let Err(err) = fs::write(&existing, PRICING_FIXTURE) {
            panic!("failed to write test pricing cache: {err}");
        }

        let policy =
            match CodexPriorityPricingPolicy::load_from_cache_paths(vec![missing, existing]) {
                Ok(policy) => policy,
                Err(err) => panic!("expected fallback cache path to load: {err}"),
            };
        let cost = match policy.calculate_us_priority_cost(
            "gpt-5.5",
            CodexTokenUsage {
                input_tokens: 1,
                output_tokens: 1,
                reasoning_tokens: 0,
                cache_read_tokens: 1,
            },
        ) {
            Ok(Some(cost)) => cost,
            Ok(None) => panic!("gpt-5.5 should have priority pricing"),
            Err(err) => panic!("cost should calculate: {err}"),
        };

        assert!(cost > 0.0);
        match fs::remove_dir_all(&base) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => panic!("failed to remove test pricing cache directory: {err}"),
        }
    }

    fn parse_policy(content: &str) -> CodexPriorityPricingPolicy {
        match CodexPriorityPricingPolicy::from_litellm_json_str(content) {
            Ok(policy) => policy,
            Err(err) => panic!("fixture should parse: {err}"),
        }
    }
}
