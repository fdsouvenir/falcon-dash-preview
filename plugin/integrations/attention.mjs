import { createHash } from 'node:crypto';
// Only redacted connection identity crosses into Work, never provider response/material.
export function recordConnectionAttention(work, connection) {
	const key =
			'integration-' + createHash('sha256').update(connection.id).digest('hex').slice(0, 32),
		actor = 'service:falcon-integrations';
	// A stable semantic creation receipt binds the connection to the canonical server-generated ID.
	const created = work.execute(
		{
			command: 'create',
			idempotency_key: key + ':create',
			input: {
				type: 'task',
				title: `Review ${connection.provider} connection failure`,
				description: `Connection ${connection.id} reported a validation problem. Use Integrations for authorized current diagnostics; no account or credential material is copied here.`,
				done_when:
					'Review current readiness or explicitly disconnect the connection, then record the disposition.'
			}
		},
		actor
	);
	const id = created.target;
	let current = work.get(id);
	const execute = (command) =>
		work.execute(
			{
				command,
				id,
				expected_version: current.version,
				idempotency_key: `${key}:${connection.version}:${command}`,
				input: {}
			},
			actor
		);
	if (current.status === 'completed') {
		execute('reopen');
		current = work.get(id);
	}
	if (current.status === 'open') execute('ready');
	return id;
}
