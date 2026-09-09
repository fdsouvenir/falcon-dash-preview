# Vault

Falcon Dash includes a KeePassXC-backed credential vault. It is a built-in product component and
the source for Falcon Dash and OpenClaw SecretRefs, not an optional third-party vault. It appears
as the Vault page inside the OpenClaw Control UI.

## Storage and access

The Vault opens your KeePassXC database where it already lives — by default
`<OpenClaw state>/passwords.kdbx` with `<OpenClaw state>/vault.key`, overridable with
`vaultDatabase` and `vaultKeyFile`:

- database: `passwords.kdbx`
- key file: `vault.key`
- authentication: `keepassxc-cli --no-password --key-file`

Policy, access history and recovery snapshots are kept separately, in the plugin's private data
directory (`<OpenClaw state>/falcon-dash/vault` by default).

This is your own KeePassXC database — the same one the SecretRef resolver reads — opened where it
already lives. Falcon Dash records its policy and access history alongside it and never rewrites
your entries.

Access is key-file only and unattended: there is no master-password prompt. The unlock key is
protected by filesystem ownership, not an external key-management system.

## Setting it up

There is nothing to set up. If you already have a database at that path it is adopted on the first
start — opened as-is, with policy recorded beside it and not one entry rewritten. If there is none,
the plugin creates one. Either way it is opened on every start after that, and the Vault page is a
credential list from the first visit: no setup step, no unlock prompt, and no lock button.

Reaching the Gateway is what authorizes you. Anyone who can sign in to the operator UI can add,
reveal and organize credentials; `vaultOwners` no longer gates the page. Agents are separate — they
hold no session, so they reach a credential only when `vaultExecutors` names them and a human grants
that entry.

Provisioning refuses to run twice, and it never overwrites a database that already exists.

If the page reads **Vault unavailable**, startup failed rather than waiting for you — usually a
missing `keepassxc-cli`, or a key file present without its database, which needs recovery. The
Gateway service health carries the reason; the other Falcon Dash modules keep working meanwhile.

`flock` serializes separate worker processes, so two operations cannot corrupt the database by
racing each other. If the binary, database or key file is missing or unreadable, the page says the
Vault is unavailable rather than showing an empty list.

## What you can do

**Search is the fastest way in.** The box above the list matches every entry in the vault at once,
whatever group it is filed under, so you never have to remember where something lives. Clearing it
returns you to browsing the group you selected in the rail on the left.

Groups and entries appear under their real KeePassXC titles — spaces and punctuation included. The
list shows each entry's title and its group. It deliberately shows nothing else: KeePassXC records
no "last modified" time for an entry, and reading any single field costs one `keepassxc-cli` call
per entry, which would add seconds to a list of dozens.

Selecting an entry opens it beside the list, showing the Password, Username, URL and Notes it
carries. Values are masked until you reveal them; **Reveal** is one control that becomes **Hide**,
and a revealed value hides itself again after fifteen seconds. A field the entry does not carry is
shown as _not set_, without a control, so you are never offered a button that can only fail.

Create groups and entries, and edit, move, rename or remove them. **Removing an entry asks you to
type its name**, and the button stays disabled until it matches exactly. Entries you create are
ordinary KeePassXC entries, so the SecretRef resolver reads them without any conversion.

Every entry is the same kind of thing. The Vault does not distinguish between a password you use
and one an agent reads — the difference is internal to storage, and nothing in the page asks you to
choose between them.

Once a group holds nothing, the list offers to remove it. An empty group reports itself as empty
rather than appearing to still hold something: KeePassXC's own listing prints a placeholder row for
a childless group, and the Vault filters that out so the group's removal control actually appears.

**Group relocation works by moving entries into a newly created group, then removing the empty old
one.** The supported CLI offers no proven-safe whole-group rename, so the product does not pretend
to have one.

**Removal and relocation create a private recovery snapshot first**, preserve redacted audit
linkage, and disable recycled old entries. An entry's identity is its exact flattened path — never a
title search — so a renamed entry cannot be silently resurrected by matching its old name.

Old handles and SecretRefs do not follow a relocated entry. Update their bindings explicitly.

## Who can see a value

Raw values never enter ordinary tool responses or logs. They travel only inside private process
pipes.

- **Any authenticated operator** can reveal and copy values, through an explicit action. Reaching
  the Gateway is the credential; there is no per-person allowlist. Anyone who can sign in to your
  Control UI can read every entry.
- **Agents cannot reveal values at all.** An agent may create an entry and may be granted _executor_
  rights to use one, but revealing is denied. No raw-value Gateway method exists to call.
- Revealed values are cleared from the interface when the transport disconnects.

Every access is recorded in a redacted audit history.

## Recovery

The owner-only **Recovery snapshots** surface takes a consistent snapshot under the Vault worker
lock: the encrypted database, its private unlock key, policy, and a consistent audit snapshot, plus
hashes. Snapshots live under the private Vault directory.

**Restore is an offline operation, not a button.** Review identity mappings and configuration,
verify the recovered data in isolation, then select it during an authorized maintenance window.

Local revocation does not retroactively erase values already copied elsewhere, or tokens a provider
has cached upstream. Rotate at the provider when a credential is genuinely exposed.

## Carrying over from a previous version

Falcon Dash 4.0 has no vault conversion. An existing `passwords.kdbx` is opened as-is; it is not
converted, and no entry gains an executor grant automatically. Grant those explicitly after
installing.

## Related

- [SecretRef integration](../secretrefs.md)
- [Backend contracts](../Technical/plugin-v4-backend.md)
- [Installed artifacts and recovery](../Technical/plugin-v4-installation.md)
