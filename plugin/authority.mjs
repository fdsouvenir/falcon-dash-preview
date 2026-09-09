import { requireValue } from './errors.mjs';
/** @typedef {{assert:()=>void,signal?:AbortSignal,beforeRequest?:()=>void}} Authority */
/** @type {Authority} */
export const internalAuthority = Object.freeze({ assert() {}, signal: undefined });
// Gateway-populated connection fields, never params or browser-supplied actors.
export function humanIdentity(client) {
	if (client?.connect?.role && client.connect.role !== 'operator') return null;
	if (client?.internal?.syntheticClient || client?.internal?.operatorRoleActor?.kind === 'system')
		return null;
	const role = client?.internal?.operatorRoleActor,
		profile = client?.authenticatedUserProfile?.profileId;
	if (profile && profile !== 'gateway-owner' && client?.authenticatedUserId) {
		if (role?.kind === 'operator' && role.profileId !== profile) return null;
		return { kind: 'operator', profileId: profile };
	}
	return role?.kind === 'operator' ? role : null;
}
export function connectionAuthority(client) {
	const identity = humanIdentity(client),
		authenticatedUserId = client?.authenticatedUserId,
		authenticatedProfileId = client?.authenticatedUserProfile?.profileId;
	const socket = client?.socket;
	const scopes = JSON.stringify([...(client?.connect?.scopes ?? [])].sort());
	const kind = identity?.kind,
		profileId = identity?.profileId,
		connId = client?.connId,
		synthetic = client?.internal?.syntheticClient;
	return Object.freeze({
		signal: client?.connectionSignal,
		assert() {
			requireValue(
				!client?.invalidated &&
					client?.socket === socket &&
					(!socket || socket.readyState === 1) &&
					!client?.connectionSignal?.aborted &&
					client?.connId === connId &&
					humanIdentity(client)?.kind === kind &&
					humanIdentity(client)?.profileId === profileId &&
					client?.authenticatedUserId === authenticatedUserId &&
					client?.authenticatedUserProfile?.profileId === authenticatedProfileId &&
					client?.internal?.syntheticClient === synthetic &&
					JSON.stringify([...(client?.connect?.scopes ?? [])].sort()) === scopes,
				'authority_changed',
				'Original connection authority is no longer valid'
			);
		}
	});
}
