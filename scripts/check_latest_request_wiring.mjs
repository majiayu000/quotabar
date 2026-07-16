import { readFileSync } from 'node:fs';
import ts from 'typescript';

const owner_configs = [
  {
    path: 'src/App.tsx',
    component_name: 'App',
    function_name: 'fetchClaudeQuota',
    owner_name: 'claude_request_generation',
    backend_methods: ['getQuota'],
    loading: true,
    loading_setter: 'setClaudeLoading',
    await_kind: 'direct',
    target_scope: 'component',
    backend_arguments: { getQuota: [] },
  },
  {
    path: 'src/components/CodexPanel.tsx',
    component_name: 'CodexPanel',
    function_name: 'fetchData',
    owner_name: 'request_generation',
    backend_methods: ['getCodexInfo', 'getCodexRateLimits', 'getCodexResetCredits'],
    loading: true,
    loading_setter: 'setLoading',
    await_kind: 'promise_all',
    promise_all_kind: 'array',
    target_scope: 'component',
    backend_arguments: {
      getCodexInfo: [],
      getCodexRateLimits: [],
      getCodexResetCredits: [],
    },
  },
  {
    path: 'src/components/CursorPanel.tsx',
    component_name: 'CursorPanel',
    function_name: 'fetchData',
    owner_name: 'request_generation',
    backend_methods: ['getCursorInfo'],
    loading: true,
    loading_setter: 'setLoading',
    await_kind: 'direct',
    target_scope: 'component',
    backend_arguments: { getCursorInfo: [] },
  },
  {
    path: 'src/components/AntigravityPanel.tsx',
    component_name: 'AntigravityPanel',
    function_name: 'fetchData',
    owner_name: 'request_generation',
    backend_methods: ['getAntigravityInfo'],
    loading: true,
    loading_setter: 'setLoading',
    await_kind: 'direct',
    target_scope: 'component',
    backend_arguments: { getAntigravityInfo: [] },
  },
  {
    path: 'src/components/CostSummarySection.tsx',
    component_name: 'CostSummarySection',
    function_name: 'loadCost',
    owner_name: 'overview_generation',
    backend_methods: ['getCostOverview'],
    loading: true,
    loading_setter: 'setLoading',
    await_kind: 'promise_all',
    promise_all_kind: 'map',
    target_scope: 'cost_effect',
    backend_arguments: { getCostOverview: ['item', 'force'] },
  },
  {
    path: 'src/components/CostSummarySection.tsx',
    component_name: 'CostSummarySection',
    function_name: 'loadDaily',
    owner_name: 'daily_generation',
    backend_methods: ['getCostDaily'],
    loading: false,
    await_kind: 'promise_all',
    promise_all_kind: 'map',
    target_scope: 'cost_effect',
    backend_arguments: { getCostDaily: ['item', 'DAILY_SERIES_DAYS', 'force'] },
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

function backend_method_calls_in(root) {
  return collect_nodes(root, (node) => {
    const parts = property_call_parts(node);
    return parts !== null && parts.owner_name === 'backend';
  }).map((node) => property_call_parts(node).method_name);
}

function same_strings(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function call_argument_names(call) {
  return call.arguments.map(identifier_name);
}

function validate_backend_call(call, method_name, config) {
  const parts = property_call_parts(call);
  ensure(parts !== null && parts.owner_name === 'backend', `${config.path}:${config.function_name} backend call owner is wrong`);
  ensure(parts.method_name === method_name, `${config.path}:${config.function_name} backend call method is wrong`);
  ensure(
    same_strings(call_argument_names(call), config.backend_arguments[method_name]),
    `${config.path}:${config.function_name} backend call arguments are wrong`,
  );
}

function validate_await_operand(await_expression, await_statement, config) {
  const expected_methods = [...config.backend_methods].sort();
  const statement_methods = backend_method_calls_in(await_statement).sort();
  ensure(same_strings(statement_methods, expected_methods), `${config.path}:${config.function_name} backend call count or placement is wrong`);

  if (config.await_kind === 'direct') {
    ensure(ts.isCallExpression(await_expression.expression), `${config.path}:${config.function_name} must directly await its backend call`);
    validate_backend_call(await_expression.expression, expected_methods[0], config);
    return;
  }

  const promise_all = property_call_parts(await_expression.expression);
  ensure(promise_all !== null, `${config.path}:${config.function_name} must await Promise.all`);
  ensure(promise_all.owner_name === 'Promise' && promise_all.method_name === 'all', `${config.path}:${config.function_name} must await Promise.all`);
  ensure(await_expression.expression.arguments.length === 1, `${config.path}:${config.function_name} Promise.all argument count is wrong`);
  const promise_all_argument = await_expression.expression.arguments[0];

  if (config.promise_all_kind === 'array') {
    ensure(ts.isArrayLiteralExpression(promise_all_argument), `${config.path}:${config.function_name} Promise.all must receive a direct array`);
    const element_methods = promise_all_argument.elements.map((element) => {
      const parts = property_call_parts(element);
      ensure(parts !== null && parts.owner_name === 'backend', `${config.path}:${config.function_name} Promise.all array elements must be direct backend calls`);
      validate_backend_call(element, parts.method_name, config);
      return parts.method_name;
    }).sort();
    ensure(same_strings(element_methods, expected_methods), `${config.path}:${config.function_name} Promise.all array dataflow is wrong`);
    return;
  }

  const map_call = property_call_parts(promise_all_argument);
  ensure(map_call !== null, `${config.path}:${config.function_name} Promise.all must receive sources.map`);
  ensure(map_call.owner_name === 'sources' && map_call.method_name === 'map', `${config.path}:${config.function_name} Promise.all must receive sources.map`);
  ensure(promise_all_argument.arguments.length === 1, `${config.path}:${config.function_name} sources.map callback count is wrong`);
  const callback = promise_all_argument.arguments[0];
  ensure(ts.isArrowFunction(callback), `${config.path}:${config.function_name} sources.map callback must be an arrow function`);
  ensure(callback.parameters.length === 1 && identifier_name(callback.parameters[0].name) === 'item', `${config.path}:${config.function_name} sources.map callback parameter is wrong`);
  const callback_call = property_call_parts(callback.body);
  ensure(callback_call !== null && callback_call.owner_name === 'backend', `${config.path}:${config.function_name} sources.map callback must directly return a backend call`);
  ensure(same_strings([callback_call.method_name], expected_methods), `${config.path}:${config.function_name} sources.map backend dataflow is wrong`);
  validate_backend_call(callback.body, callback_call.method_name, config);
}

function direct_variable_declarations(block, name) {
  return block.statements.flatMap((statement) => {
    if (!ts.isVariableStatement(statement)) return [];
    return statement.declarationList.declarations.filter((declaration) => identifier_name(declaration.name) === name);
  });
}

function validate_owner(target_body, config) {
  const declarations = direct_variable_declarations(target_body, config.function_name);
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
  const await_statement = try_statement.tryBlock.statements[await_index];
  const await_expressions = collect_nodes(await_statement, ts.isAwaitExpression);
  ensure(await_expressions.length === 1, `${config.path}:${config.function_name} await expression count is not one`);
  validate_await_operand(await_expressions[0], await_statement, config);
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

function named_import_bindings(source_file) {
  return source_file.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
    const named_bindings = statement.importClause?.namedBindings;
    if (!named_bindings || !ts.isNamedImports(named_bindings)) return [];
    return named_bindings.elements.map((element) => ({
      module_name: statement.moduleSpecifier.text,
      imported_name: identifier_name(element.propertyName ?? element.name),
      local_name: identifier_name(element.name),
    }));
  });
}

function validate_named_import(source_file, path, module_name, binding_name) {
  const relevant = named_import_bindings(source_file).filter((binding) => (
    binding.imported_name === binding_name || binding.local_name === binding_name
  ));
  ensure(relevant.length === 1, `${path} ${binding_name} import binding count is wrong`);
  const binding = relevant[0];
  ensure(
    binding.module_name === module_name
      && binding.imported_name === binding_name
      && binding.local_name === binding_name,
    `${path} ${binding_name} import provenance is wrong`,
  );
}

function is_value_binding_identifier(node) {
  if (!ts.isIdentifier(node)) return false;
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)) return parent.name === node;
  if (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent)) return parent.name === node;
  if (ts.isClassDeclaration(parent) || ts.isClassExpression(parent) || ts.isEnumDeclaration(parent)) return parent.name === node;
  return false;
}

function validate_no_shadowing(source_file, path) {
  const protected_names = new Set(['backend', 'useLatestRequestGeneration', 'useEffect', 'useCallback', 'Promise']);
  const shadows = collect_nodes(source_file, is_value_binding_identifier)
    .map(identifier_name)
    .filter((name) => protected_names.has(name));
  ensure(shadows.length === 0, `${path} protected binding is shadowed`);
}

function direct_hook_blocks(component_body, hook_name) {
  return component_body.statements.flatMap((statement) => {
    if (!ts.isExpressionStatement(statement) || !is_identifier_call(statement.expression, hook_name)) return [];
    const callback = statement.expression.arguments[0];
    ensure(callback && ts.isArrowFunction(callback) && ts.isBlock(callback.body), `${hook_name} callback must be a block arrow function`);
    return [callback.body];
  });
}

function get_target_body(component_body, path, configs) {
  if (configs.every((config) => config.target_scope === 'component')) return component_body;
  ensure(configs.every((config) => config.target_scope === 'cost_effect'), `${path} target scope mapping is inconsistent`);
  const candidates = direct_hook_blocks(component_body, 'useEffect').filter((block) => (
    configs.every((config) => direct_variable_declarations(block, config.function_name).length === 1)
  ));
  ensure(candidates.length === 1, `${path} owning effect count is wrong`);
  return candidates[0];
}

function validate_expected_backend_method_ownership(component_body, path, configs) {
  for (const config of configs) {
    for (const method_name of config.backend_methods) {
      const calls = collect_nodes(component_body, (node) => {
        const parts = property_call_parts(node);
        return parts !== null && parts.owner_name === 'backend' && parts.method_name === method_name;
      });
      ensure(calls.length === 1, `${path} ${method_name} component call count is wrong`);
    }
  }
}

function validate_hook_bindings(component_body, path, configs) {
  const hook_calls = collect_nodes(component_body, (node) => is_identifier_call(node, 'useLatestRequestGeneration'));
  ensure(hook_calls.length === configs.length, `${path} hook call count is wrong`);
  const owner_names = hook_calls.map((call) => {
    ensure(call.arguments.length === 0, `${path} generation hook must have no arguments`);
    const declaration = call.parent;
    ensure(ts.isVariableDeclaration(declaration), `${path} generation hook is not bound by a variable declarator`);
    ensure(declaration.initializer === call, `${path} generation hook is not the declarator initializer`);
    const variable_statement = declaration.parent.parent;
    ensure(ts.isVariableStatement(variable_statement), `${path} generation hook is not a variable statement`);
    ensure(variable_statement.parent === component_body, `${path} generation hook must be bound directly in its owning component`);
    return identifier_name(declaration.name);
  }).sort();
  const expected_names = configs.map((config) => config.owner_name).sort();
  ensure(same_strings(owner_names, expected_names), `${path} generation owner binding is wrong`);
}

function get_component_body(source_file, path, configs) {
  const component_name = configs[0].component_name;
  ensure(configs.every((config) => config.component_name === component_name), `${path} component mapping is inconsistent`);
  const components = collect_nodes(source_file, (node) => (
    ts.isFunctionDeclaration(node) && identifier_name(node.name) === component_name
  ));
  ensure(components.length === 1, `${path}:${component_name} component count is not one`);
  ensure(components[0].parent === source_file, `${path}:${component_name} must be declared at module scope`);
  ensure(components[0].body !== undefined, `${path}:${component_name} has no body`);
  return components[0].body;
}

function validate_cost_cleanup(target_body) {
  const returns = target_body.statements.filter(ts.isReturnStatement);
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

function validate_antigravity_pause(component_body) {
  const effects = direct_hook_blocks(component_body, 'useEffect').filter((block) => {
    const has_fetch = block.statements.some((statement) => (
      ts.isExpressionStatement(statement) && is_identifier_call(statement.expression, 'fetchData')
    ));
    const has_interval = block.statements.some((statement) => (
      collect_nodes(statement, (node) => is_identifier_call(node, 'setInterval')).length > 0
    ));
    return has_fetch && has_interval;
  });
  ensure(effects.length === 1, 'Antigravity polling effect count is wrong');
  const statements = effects[0].statements;
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

  for (const [path, configs] of configs_by_path) {
    const source = sources.get(path);
    ensure(typeof source === 'string', `${path} source is missing`);
    const source_file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    ensure(source_file.parseDiagnostics.length === 0, `${path} source has parse errors`);
    const component_body = get_component_body(source_file, path, configs);
    const component_prefix = path === 'src/App.tsx' ? '.' : '..';
    validate_named_import(source_file, path, `${component_prefix}/services/backend`, 'backend');
    validate_named_import(source_file, path, `${component_prefix}/hooks/use_latest_request_generation`, 'useLatestRequestGeneration');
    validate_named_import(source_file, path, 'react', 'useEffect');
    if (configs.some((config) => config.target_scope === 'component')) {
      validate_named_import(source_file, path, 'react', 'useCallback');
    }
    validate_no_shadowing(source_file, path);
    validate_hook_bindings(component_body, path, configs);
    const target_body = get_target_body(component_body, path, configs);
    for (const config of configs) validate_owner(target_body, config);
    validate_expected_backend_method_ownership(component_body, path, configs);
    if (path === 'src/components/CostSummarySection.tsx') validate_cost_cleanup(target_body);
    if (path === 'src/components/AntigravityPanel.tsx') validate_antigravity_pause(component_body);
  }
}

check_latest_request_wiring();
