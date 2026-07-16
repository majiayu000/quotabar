import { readFileSync } from 'node:fs';
import ts from 'typescript';

const owner_configs = [
  {
    path: 'src/App.tsx',
    function_name: 'fetchClaudeQuota',
    owner_name: 'claude_request_generation',
    backend_methods: ['getQuota'],
    loading: true,
    loading_setter: 'setClaudeLoading',
  },
  {
    path: 'src/components/CodexPanel.tsx',
    function_name: 'fetchData',
    owner_name: 'request_generation',
    backend_methods: ['getCodexInfo', 'getCodexRateLimits', 'getCodexResetCredits'],
    loading: true,
    loading_setter: 'setLoading',
  },
  {
    path: 'src/components/CursorPanel.tsx',
    function_name: 'fetchData',
    owner_name: 'request_generation',
    backend_methods: ['getCursorInfo'],
    loading: true,
    loading_setter: 'setLoading',
  },
  {
    path: 'src/components/AntigravityPanel.tsx',
    function_name: 'fetchData',
    owner_name: 'request_generation',
    backend_methods: ['getAntigravityInfo'],
    loading: true,
    loading_setter: 'setLoading',
  },
  {
    path: 'src/components/CostSummarySection.tsx',
    function_name: 'loadCost',
    owner_name: 'overview_generation',
    backend_methods: ['getCostOverview'],
    loading: true,
    loading_setter: 'setLoading',
  },
  {
    path: 'src/components/CostSummarySection.tsx',
    function_name: 'loadDaily',
    owner_name: 'daily_generation',
    backend_methods: ['getCostDaily'],
    loading: false,
  },
];

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function collect_nodes(root, predicate) {
  const matches = [];
  const visit = (node) => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
}

function identifier_name(node) {
  return ts.isIdentifier(node) ? node.text : null;
}

function is_identifier_call(node, name) {
  return ts.isCallExpression(node) && identifier_name(node.expression) === name;
}

function property_call_parts(node) {
  if (!ts.isCallExpression(node)) return null;
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  const owner_name = identifier_name(node.expression.expression);
  if (owner_name === null) return null;
  return { node, owner_name, method_name: node.expression.name.text };
}

function is_property_call(node, owner_name, method_name, argument_name) {
  const parts = property_call_parts(node);
  if (parts === null) return false;
  if (parts.owner_name !== owner_name || parts.method_name !== method_name) return false;
  if (argument_name === undefined) return node.arguments.length === 0;
  if (node.arguments.length !== 1) return false;
  return identifier_name(node.arguments[0]) === argument_name;
}

function is_return_statement(node) {
  if (ts.isReturnStatement(node)) return true;
  if (!ts.isBlock(node)) return false;
  return node.statements.length === 1 && ts.isReturnStatement(node.statements[0]);
}

function is_fail_closed_guard(statement, owner_name) {
  if (!ts.isIfStatement(statement) || statement.elseStatement !== undefined) return false;
  if (!ts.isPrefixUnaryExpression(statement.expression)) return false;
  if (statement.expression.operator !== ts.SyntaxKind.ExclamationToken) return false;
  if (!is_property_call(statement.expression.operand, owner_name, 'isCurrent', 'generation')) return false;
  return is_return_statement(statement.thenStatement);
}

function is_loading_finish_guard(statement, owner_name, loading_setter) {
  if (!ts.isIfStatement(statement) || statement.elseStatement !== undefined) return false;
  if (!is_property_call(statement.expression, owner_name, 'isCurrent', 'generation')) return false;
  if (!ts.isBlock(statement.thenStatement)) return false;
  if (statement.thenStatement.statements.length !== 1) return false;
  const loading_statement = statement.thenStatement.statements[0];
  if (!ts.isExpressionStatement(loading_statement)) return false;
  return is_identifier_call(loading_statement.expression, loading_setter)
    && loading_statement.expression.arguments.length === 1
    && loading_statement.expression.arguments[0].kind === ts.SyntaxKind.FalseKeyword;
}

function get_function_body(declaration, config) {
  let initializer = declaration.initializer;
  ensure(initializer !== undefined, `${config.path}:${config.function_name} has no initializer`);
  if (is_identifier_call(initializer, 'useCallback')) {
    ensure(initializer.arguments.length > 0, `${config.path}:${config.function_name} useCallback has no function`);
    initializer = initializer.arguments[0];
  }
  ensure(ts.isArrowFunction(initializer), `${config.path}:${config.function_name} is not an arrow function`);
  ensure(initializer.modifiers !== undefined, `${config.path}:${config.function_name} is not async`);
  ensure(initializer.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword), `${config.path}:${config.function_name} is not async`);
  ensure(ts.isBlock(initializer.body), `${config.path}:${config.function_name} has no block body`);
  return initializer.body;
}

function is_generation_start(statement, owner_name) {
  if (!ts.isVariableStatement(statement)) return false;
  if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) return false;
  if (statement.declarationList.declarations.length !== 1) return false;
  const declaration = statement.declarationList.declarations[0];
  if (identifier_name(declaration.name) !== 'generation') return false;
  if (declaration.initializer === undefined) return false;
  return is_property_call(declaration.initializer, owner_name, 'begin', undefined)
    && declaration.initializer.arguments.length === 0;
}

function backend_methods_in(statement) {
  const methods = collect_nodes(statement, (node) => {
    const parts = property_call_parts(node);
    return parts !== null && parts.owner_name === 'backend';
  }).map((node) => property_call_parts(node).method_name);
  return [...new Set(methods)].sort();
}

function same_strings(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function validate_owner(source_file, config) {
  const declarations = collect_nodes(source_file, (node) => (
    ts.isVariableDeclaration(node) && identifier_name(node.name) === config.function_name
  ));
  ensure(declarations.length === 1, `${config.path}:${config.function_name} target count is not one`);
  const body = get_function_body(declarations[0], config);
  ensure(body.statements.length > 1, `${config.path}:${config.function_name} body is incomplete`);
  ensure(is_generation_start(body.statements[0], config.owner_name), `${config.path}:${config.function_name} must begin with its generation token`);

  const try_statements = body.statements.filter(ts.isTryStatement);
  ensure(try_statements.length === 1, `${config.path}:${config.function_name} try count is not one`);
  const try_statement = try_statements[0];
  const await_indexes = [];
  for (let index = 0; index < try_statement.tryBlock.statements.length; index += 1) {
    const awaits = collect_nodes(try_statement.tryBlock.statements[index], ts.isAwaitExpression);
    if (awaits.length > 0) await_indexes.push(index);
  }
  ensure(await_indexes.length === 1, `${config.path}:${config.function_name} backend await count is not one`);
  const await_index = await_indexes[0];
  const actual_methods = backend_methods_in(try_statement.tryBlock.statements[await_index]);
  const expected_methods = [...config.backend_methods].sort();
  ensure(same_strings(actual_methods, expected_methods), `${config.path}:${config.function_name} backend await mapping is wrong`);
  const success_guard = try_statement.tryBlock.statements[await_index + 1];
  ensure(success_guard !== undefined, `${config.path}:${config.function_name} has no success guard`);
  ensure(is_fail_closed_guard(success_guard, config.owner_name), `${config.path}:${config.function_name} success guard is not fail closed`);

  ensure(try_statement.catchClause !== undefined, `${config.path}:${config.function_name} has no catch`);
  const catch_statements = try_statement.catchClause.block.statements;
  ensure(catch_statements.length > 0, `${config.path}:${config.function_name} catch is empty`);
  ensure(is_fail_closed_guard(catch_statements[0], config.owner_name), `${config.path}:${config.function_name} catch guard is not fail closed`);

  if (config.loading) {
    ensure(try_statement.finallyBlock !== undefined, `${config.path}:${config.function_name} has no finally`);
    const finally_statements = try_statement.finallyBlock.statements;
    ensure(finally_statements.length === 1, `${config.path}:${config.function_name} finally must contain one current guard`);
    ensure(is_loading_finish_guard(finally_statements[0], config.owner_name, config.loading_setter), `${config.path}:${config.function_name} finally loading guard is wrong`);
  }
}

function validate_hook_bindings(source_file, path, configs) {
  const hook_calls = collect_nodes(source_file, (node) => is_identifier_call(node, 'useLatestRequestGeneration'));
  ensure(hook_calls.length === configs.length, `${path} hook call count is wrong`);
  const owner_names = hook_calls.map((call) => {
    ensure(call.arguments.length === 0, `${path} generation hook must have no arguments`);
    const declaration = call.parent;
    ensure(ts.isVariableDeclaration(declaration), `${path} generation hook is not bound by a variable declarator`);
    ensure(declaration.initializer === call, `${path} generation hook is not the declarator initializer`);
    return identifier_name(declaration.name);
  }).sort();
  const expected_names = configs.map((config) => config.owner_name).sort();
  ensure(same_strings(owner_names, expected_names), `${path} generation owner binding is wrong`);
}

function validate_cost_cleanup(source_file) {
  const effects = collect_nodes(source_file, (node) => {
    if (!is_identifier_call(node, 'useEffect')) return false;
    return collect_nodes(node, (child) => (
      ts.isVariableDeclaration(child)
      && (identifier_name(child.name) === 'loadCost' || identifier_name(child.name) === 'loadDaily')
    )).length === 2;
  });
  ensure(effects.length === 1, 'CostSummarySection owning effect count is wrong');
  const effect_function = effects[0].arguments[0];
  ensure(ts.isArrowFunction(effect_function), 'CostSummarySection owning effect is not an arrow function');
  ensure(ts.isBlock(effect_function.body), 'CostSummarySection owning effect has no block body');
  const returns = effect_function.body.statements.filter(ts.isReturnStatement);
  ensure(returns.length === 1, 'CostSummarySection owning effect cleanup count is wrong');
  const cleanup = returns[0].expression;
  ensure(cleanup !== undefined && ts.isArrowFunction(cleanup), 'CostSummarySection cleanup is not an arrow function');
  ensure(ts.isBlock(cleanup.body), 'CostSummarySection cleanup has no block body');
  const invalidated = cleanup.body.statements.flatMap((statement) => {
    if (!ts.isExpressionStatement(statement)) return [];
    const parts = property_call_parts(statement.expression);
    if (parts === null || parts.method_name !== 'invalidate') return [];
    return [parts.owner_name];
  }).sort();
  ensure(same_strings(invalidated, ['daily_generation', 'overview_generation']), 'CostSummarySection cleanup must invalidate both lanes exactly');
}

function validate_antigravity_pause(source_file) {
  const effects = collect_nodes(source_file, (node) => {
    if (!is_identifier_call(node, 'useEffect')) return false;
    const has_fetch = collect_nodes(node, (child) => is_identifier_call(child, 'fetchData')).length > 0;
    const has_interval = collect_nodes(node, (child) => is_identifier_call(child, 'setInterval')).length > 0;
    return has_fetch && has_interval;
  });
  ensure(effects.length === 1, 'Antigravity polling effect count is wrong');
  const effect_function = effects[0].arguments[0];
  ensure(ts.isArrowFunction(effect_function) && ts.isBlock(effect_function.body), 'Antigravity polling effect has no block body');
  const statements = effect_function.body.statements;
  const pause_index = statements.findIndex((statement) => {
    if (!ts.isIfStatement(statement) || !ts.isBinaryExpression(statement.expression)) return false;
    const expression = statement.expression;
    return identifier_name(expression.left) === 'autoRefreshIntervalMs'
      && expression.operatorToken.kind === ts.SyntaxKind.LessThanEqualsToken
      && ts.isNumericLiteral(expression.right)
      && expression.right.text === '0'
      && is_return_statement(statement.thenStatement);
  });
  const interval_index = statements.findIndex((statement) => (
    collect_nodes(statement, (node) => is_identifier_call(node, 'setInterval')).length > 0
  ));
  ensure(pause_index >= 0 && pause_index < interval_index, 'Antigravity interval zero guard must precede setInterval');
}

export function read_owner_sources() {
  const sources = new Map();
  for (const config of owner_configs) {
    if (!sources.has(config.path)) sources.set(config.path, readFileSync(config.path, 'utf8'));
  }
  return sources;
}

export function check_latest_request_wiring(sources = read_owner_sources()) {
  const configs_by_path = new Map();
  for (const config of owner_configs) {
    const configs = configs_by_path.get(config.path) ?? [];
    configs.push(config);
    configs_by_path.set(config.path, configs);
  }

  const source_files = new Map();
  for (const [path, configs] of configs_by_path) {
    const source = sources.get(path);
    ensure(typeof source === 'string', `${path} source is missing`);
    const source_file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    source_files.set(path, source_file);
    validate_hook_bindings(source_file, path, configs);
    for (const config of configs) validate_owner(source_file, config);
  }

  validate_cost_cleanup(source_files.get('src/components/CostSummarySection.tsx'));
  validate_antigravity_pause(source_files.get('src/components/AntigravityPanel.tsx'));
}

check_latest_request_wiring();
