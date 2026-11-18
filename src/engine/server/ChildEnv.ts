/**
 * The environment for a child server process (a game server, a bot match
 * runner): the parent's, without its secrets (the bot secret, any token or
 * password) and without match credentials left from elsewhere. A spawner adds
 * the child's own credentials afterwards.
 */
export function childProcessEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (/SECRET|TOKEN|PASSWORD/i.test(name) || name.startsWith("SHAG_MATCH_")) continue;
    childEnv[name] = value;
  }
  return childEnv;
}
