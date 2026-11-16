import { packageName } from '../src/package';

describe('@linked.cm/mcp', () => {
  it('is the package it says it is', () => {
    expect(packageName).toBe('@linked.cm/mcp');
  });

  it('has the delegated call context it builds on', async () => {
    const { runAsDelegate, requireSessionUser } = await import('@_linked/server-utils/utils/CallContext');
    const user = { id: 'https://example.org/ada' };
    expect(runAsDelegate(user, { id: 'https://example.org/connection/1' }, () => requireSessionUser())).toBe(user);
  });
});
