import { internalAuthority } from '../authority.mjs';
import { DomainError, requireValue } from '../errors.mjs';
// Endpoint constants are adapter-owned, never caller-controlled destinations.
async function request(fetcher, url, options, authority = internalAuthority) {
	authority.assert();
	authority.beforeRequest?.();
	const r = await fetcher(url, {
		...options,
		redirect: 'error',
		signal: authority.signal
			? AbortSignal.any([authority.signal, AbortSignal.timeout(15000)])
			: AbortSignal.timeout(15000)
	});
	authority.assert();
	if (!r.ok)
		throw new DomainError(
			r.status === 403
				? 'scope_failure'
				: r.status === 401
					? 'reauthorization_required'
					: 'provider_unavailable',
			'Provider request failed'
		);
	try {
		if (!r.body?.getReader) return await r.json();
		const reader = r.body.getReader();
		let size = 0;
		const chunks = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 262144) {
				await reader.cancel();
				throw new Error('oversized');
			}
			chunks.push(Buffer.from(value));
		}
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch {
		throw new DomainError(
			'provider_response_invalid',
			'Provider returned an invalid or oversized response'
		);
	}
}
export function adapters(fetcher = fetch) {
	return {
		highlevel: {
			supports_refresh: true,
			dispatch_guarded: true,
			async exchange(material, { code, redirect_uri }, authority = internalAuthority) {
				const body = new URLSearchParams({
					grant_type: 'authorization_code',
					client_id: material.client_id,
					client_secret: material.client_secret,
					code,
					redirect_uri
				});
				const output = await request(
					fetcher,
					'https://services.leadconnectorhq.com/oauth/token',
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
						body
					},
					authority
				);
				requireValue(
					typeof output.access_token === 'string' &&
						output.access_token.length &&
						typeof output.refresh_token === 'string' &&
						output.refresh_token.length,
					'provider_response_invalid',
					'Provider omitted required OAuth token pair'
				);
				return {
					material: { access_token: output.access_token, refresh_token: output.refresh_token }
				};
			},
			async test(material, connection, authority = internalAuthority) {
				requireValue(
					connection.account_id,
					'input_required',
					'HighLevel validation requires a location id'
				);
				const result = await request(
					fetcher,
					`https://services.leadconnectorhq.com/locations/${encodeURIComponent(connection.account_id)}`,
					{ headers: { Authorization: `Bearer ${material.access_token}`, Version: 'v3' } },
					authority
				);
				requireValue(
					result.location?.id === connection.account_id,
					'provider_response_invalid',
					'Provider did not confirm the configured sub-account identity'
				);
				return { health: 'healthy', validated_capabilities: ['locations.readonly'] };
			},
			async refresh(material, _connection, authority = internalAuthority) {
				const body = new URLSearchParams({
					grant_type: 'refresh_token',
					client_id: material.client_id,
					client_secret: material.client_secret,
					refresh_token: material.refresh_token
				});
				const out = await request(
					fetcher,
					'https://services.leadconnectorhq.com/oauth/token',
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
						body
					},
					authority
				);
				requireValue(
					typeof out.access_token === 'string' &&
						out.access_token.length &&
						Number.isFinite(out.expires_in) &&
						out.expires_in > 0,
					'provider_response_invalid',
					'Provider omitted token or expiry'
				);
				const next = { access_token: out.access_token };
				if (out.refresh_token) next.refresh_token = out.refresh_token;
				return {
					material: next,
					health: 'healthy',
					expires_at: Date.now() + out.expires_in * 1000,
					next_at: Date.now() + Math.max(1, out.expires_in - 300) * 1000
				};
			}
		},
		schwab: {
			supports_refresh: true,
			dispatch_guarded: true,
			async test(material, connection, authority = internalAuthority) {
				requireValue(
					typeof material.access_token === 'string' && material.access_token.length > 0,
					'reauthorization_required',
					'Protected access token is unavailable'
				);
				const cutoff = Date.parse(material.reauthorize_at);
				requireValue(
					Number.isFinite(cutoff) && cutoff > Date.now(),
					'reauthorization_required',
					'An explicit current renewal cutoff is required; complete consent rather than assuming indefinite refresh'
				);
				requireValue(
					typeof connection.account_id === 'string' && connection.account_id.length > 0,
					'invalid_input',
					'Configure the expected Schwab account hash'
				);
				const out = await request(
					fetcher,
					'https://api.schwabapi.com/trader/v1/accounts/accountNumbers',
					{ headers: { Authorization: `Bearer ${material.access_token}` } },
					authority
				);
				requireValue(
					Array.isArray(out) && out.some((account) => account.hashValue === connection.account_id),
					'scope_failure',
					'The configured account was not verified'
				);
				return {
					health: 'healthy',
					validated_capabilities: ['account_numbers.read'],
					reauthorize_at: cutoff,
					next_at: Math.min(Date.now() + 3600000, cutoff)
				};
			},
			async refresh(material, _connection, authority = internalAuthority) {
				const cutoff = Date.parse(material.reauthorize_at);
				requireValue(
					Number.isFinite(cutoff) && cutoff > Date.now(),
					'reauthorization_required',
					'Renew consent before attempting another refresh'
				);
				for (const field of ['client_id', 'client_secret', 'refresh_token'])
					requireValue(
						typeof material[field] === 'string' && material[field].length > 0,
						'reauthorization_required',
						'Required protected OAuth material is unavailable'
					);
				const out = await request(
					fetcher,
					'https://api.schwabapi.com/v1/oauth/token',
					{
						method: 'POST',
						headers: {
							Authorization: `Basic ${Buffer.from(material.client_id + ':' + material.client_secret).toString('base64')}`,
							'Content-Type': 'application/x-www-form-urlencoded'
						},
						body: new URLSearchParams({
							grant_type: 'refresh_token',
							refresh_token: material.refresh_token
						})
					},
					authority
				);
				requireValue(
					typeof out.access_token === 'string' &&
						out.access_token.length > 0 &&
						Number.isFinite(out.expires_in) &&
						out.expires_in > 0,
					'provider_response_invalid',
					'Provider omitted access token or expiry'
				);
				const next = { access_token: out.access_token };
				if (out.refresh_token) next.refresh_token = out.refresh_token;
				return {
					material: next,
					health: 'healthy',
					expires_at: Date.now() + out.expires_in * 1000,
					reauthorize_at: cutoff,
					next_at: Math.min(Date.now() + Math.max(1, out.expires_in - 300) * 1000, cutoff)
				};
			}
		},

		cloudflare: {
			supports_refresh: false,
			dispatch_guarded: true,
			async test(material, connection, authority = internalAuthority) {
				requireValue(
					typeof material.api_token === 'string' && material.api_token.length > 0,
					'reauthorization_required',
					'Protected API token is unavailable'
				);
				const out = await request(
					fetcher,
					'https://api.cloudflare.com/client/v4/user/tokens/verify',
					{ headers: { Authorization: `Bearer ${material.api_token}` } },
					authority
				);
				requireValue(
					out.success && out.result?.status === 'active',
					'scope_failure',
					'Token is not active'
				);
				requireValue(
					typeof connection.account_id === 'string' &&
						/^[a-fA-F0-9]{32}$/.test(connection.account_id),
					'invalid_input',
					'Configure the exact Cloudflare account id'
				);
				const account = await request(
					fetcher,
					`https://api.cloudflare.com/client/v4/accounts/${connection.account_id}`,
					{ headers: { Authorization: `Bearer ${material.api_token}` } },
					authority
				);
				requireValue(
					account.success && account.result?.id === connection.account_id,
					'scope_failure',
					'Account read permission was not verified'
				);
				return {
					health: 'healthy',
					validated_capabilities: ['account.read'],
					...(typeof out.result?.expires_on === 'string' &&
					Number.isFinite(Date.parse(out.result.expires_on))
						? { expires_at: Date.parse(out.result.expires_on) }
						: {})
				};
			},
			async refresh() {
				throw new DomainError(
					'unsupported_operation',
					'Static tokens must be explicitly rotated, not refreshed'
				);
			}
		}
	};
}
