# KeePassXC SecretRef Integration

Falcon Dash includes a KeePassXC-backed vault and an OpenClaw exec-secret provider. The vault is a
product component of the plugin, not an optional external service. The native Vault page and the
resolver use the same database and key file:

- database: `~/.openclaw/passwords.kdbx`
- key file: `~/.openclaw/vault.key`
- authentication: `keepassxc-cli --no-password --key-file`

Raw values are resolved inside the Gateway process. Agent and browser interfaces receive scoped
operations or redacted metadata, never credentials.

The resolver ships as `bin/keepassxc-secret-resolver.cjs`. An installed OpenClaw config references
it by absolute path, so moving or deleting that file breaks credential resolution across the
gateway.

## Provisioning

`keepassxc-cli` must exist on the host. The Vault opens the operator's own KeePassXC database,
defaulting to `<stateDir>/passwords.kdbx` with `<stateDir>/vault.key` — the same database the
bundled resolver above reads — and `vaultDatabase`/`vaultKeyFile` override both. Policy, audit and
recovery snapshots stay in the plugin's private `<dataDir>/vault` directory.

`ready()` is the whole lifecycle and it is idempotent. It **adopts** a database that already exists,
writing policy beside it without touching a credential; it creates one only when genuinely absent;
it reconciles `vaultOwners`/`vaultExecutors` into the stored policy, then unlocks. Reconciliation
matters because the policy is otherwise written once, at provisioning — without it a later
`vaultExecutors` edit would not reach an agent without a recovery.

Two entry shapes coexist. An entry a person created holds a plain secret with the ordinary
UserName/URL/Notes fields, which is what the exec resolver reads. A credential the plugin creates
for an agent holds a JSON envelope carrying its version, executor grants and revocation. Neither is
ever rewritten into the other's shape: converting a person's entries would break every SecretRef
that resolves them.

Provisioning is never an operator action, so `initialize`, `unlock` and `lock` are absent from the
protected RPC surface. A Vault that reports `initialized: false` at runtime means startup failed;
the plugin reports that through service health and leaves Work, Integrations and Documents running.

## Listing entries for the Vault page

The Vault page loads the whole tree in one protected call, `inventory_all`, so its search box can
match any entry without walking group by group. That action returns handles and kinds only — never
a field value — and reuses the recursive listing the worker already reads to validate handles, so
it costs no extra `keepassxc-cli` invocation. Reading a field still requires an explicit `reveal`
or `copy` for one named field on one entry.

`keepassxc-cli ls` prints an `[empty]` placeholder for a childless group, and the recursive listing
prints it under its group as `<group>/[empty]`. `inventory_all` drops any path whose last segment is
that placeholder: reporting it as an entry would make an emptied group look occupied, hiding its
removal control and offering a row whose `metadata` call could only fail.

## Configure OpenClaw

Register the bundled resolver in `~/.openclaw/openclaw.json`. `providers` is an object keyed by
provider name:

```json
{
	"secrets": {
		"providers": {
			"keepassxc": {
				"source": "exec",
				"command": "/absolute/path/to/falcon-dash/bin/keepassxc-secret-resolver.cjs",
				"passEnv": ["PATH", "HOME"],
				"jsonOnly": true
			}
		}
	}
}
```

For a package installation, run `falcon-dash path` to locate the package root, then append
`/bin/keepassxc-secret-resolver.cjs`. Restart OpenClaw after changing its configuration.

## Secret IDs

An ID is a KeePassXC entry path with an optional field suffix:

| ID                     | Value returned |
| ---------------------- | -------------- |
| `Group/Entry`          | `Password`     |
| `Group/Entry:Password` | `Password`     |
| `Group/Entry:UserName` | `UserName`     |
| `Group/Entry:URL`      | `URL`          |
| `Group/Entry:Notes`    | `Notes`        |
| `Group/Entry:Title`    | `Title`        |

Use the provider from OpenClaw configuration with a SecretRef:

```json
{
	"source": "exec",
	"provider": "keepassxc",
	"id": "Providers/anthropic/apiKey"
}
```

The resolver implements exec-provider protocol v1, reads JSON on stdin, writes JSON on stdout, and
returns per-ID errors without exposing unrelated entries.

## Manual bootstrap

Until installation provisions the vault, create it with key-file-only authentication:

```bash
mkdir -p ~/.openclaw
keepassxc-cli db-create --set-key-file ~/.openclaw/vault.key ~/.openclaw/passwords.kdbx
```

Protect both files with operating-system permissions. Possession of the database and key file is
sufficient to read the vault.
