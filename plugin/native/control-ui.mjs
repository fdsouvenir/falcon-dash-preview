import { defineControlUiPlugin } from 'openclaw/plugin-sdk/control-ui';
import { createFeatureClient } from 'openclaw/plugin-sdk/feature-contract';
import { workFeature, commandInputs } from '../work/feature-contract.mjs';
import { ViewLifetime, message } from './lifetime.mjs';
import './style.css';
import { documentPreview } from './markdown.mjs';
import { formatOperatorTime } from './dates.mjs';
const names = {
	work: 'Work',
	integrations: 'Integrations',
	vault: 'Vault',
	documents: 'Documents'
};
const human = (s) =>
	String(s ?? '')
		.replaceAll('_', ' ')
		.replace(/\b\w/g, (c) => c.toUpperCase());
function el(tag, text, attrs = {}) {
	const n = document.createElement(tag);
	if (text !== null && text !== undefined) n.textContent = String(text);
	for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
	return n;
}
function button(label, run, kind = '') {
	const b = el('button', label, { type: 'button', class: kind });
	b.addEventListener('click', run);
	return b;
}
function field(label, { value = '', type = 'text', multiline = false, options } = {}) {
	const wrap = el('label', null, { class: 'falcon-field' });
	wrap.append(el('span', label));
	const input = options ? el('select') : el(multiline ? 'textarea' : 'input');
	input.setAttribute('aria-label', label);
	if (options)
		for (const option of options) {
			const [value, text] = Array.isArray(option) ? option : [option, human(option)];
			input.append(el('option', text, { value }));
		}
	else if (!multiline) input.type = type;
	input.value =
		options && value === '' ? (Array.isArray(options[0]) ? options[0][0] : options[0]) : value;
	wrap.append(input);
	return { wrap, input };
}
function paragraph(parent, text, cls = '') {
	parent.append(el('p', text, { class: cls }));
}
function renderValue(value, depth = 0) {
	if (value == null) return el('span', 'Not set');
	if (typeof value !== 'object') return el('p', String(value), { class: 'prose' });
	if (depth > 6) return el('p', 'Additional nested context is available in full history.');
	if (Array.isArray(value)) {
		const list = el('ul', null, { class: 'structured-list' });
		for (const item of value.slice(0, 100)) {
			const li = el('li');
			li.append(renderValue(item, depth + 1));
			list.append(li);
		}
		if (!value.length) list.append(el('li', 'None'));
		return list;
	}
	const list = el('dl', null, { class: 'structured-details' });
	for (const [key, item] of Object.entries(value)) {
		if (['task_id', 'definition_id', 'created_at', 'updated_at', 'version', 'id'].includes(key)) {
			const detail = el('details');
			detail.append(el('summary', human(key)), renderValue(item, depth + 1));
			list.append(detail);
			continue;
		}
		list.append(el('dt', human(key)));
		const dd = el('dd');
		if (['ref', 'url'].includes(key) && typeof item === 'string' && /^https:\/\//i.test(item)) {
			const link = el('a', item, { href: item, target: '_blank', rel: 'noopener noreferrer' });
			dd.append(link);
		} else dd.append(renderValue(item, depth + 1));
		list.append(dd);
	}
	return list;
}
function detailText(parent, label, value) {
	if (value == null) return;
	const section = el('section', null, { class: 'detail-section' });
	section.append(el('h3', label), renderValue(value));
	parent.append(section);
}

function schemaEditor(schema, label, value) {
	if ('const' in schema)
		return { node: el('p', `${label}: ${human(schema.const)}`), read: () => schema.const };
	const enums = schema.anyOf?.filter((s) => 'const' in s);
	if (enums?.length === schema.anyOf?.length && enums?.length) {
		const f = field(label, {
			value: value == null ? '' : String(value),
			options: enums.map((s) => [String(s.const), human(s.const)])
		});
		return {
			node: f.wrap,
			read: () => enums.find((s) => String(s.const) === f.input.value)?.const
		};
	}
	if (schema.anyOf) {
		const nonnull = schema.anyOf.find((s) => s.type !== 'null');
		if (schema.anyOf.some((s) => s.type === 'null')) {
			const f = field(label + ' (leave blank for none)', { value: value ?? '' });
			return { node: f.wrap, read: () => f.input.value || null };
		}
		return schemaEditor(nonnull, label, value);
	}
	if (schema.type === 'object' && schema.properties && value == null && !label.endsWith(' *')) {
		const node = el('fieldset'),
			toggle = field('Include ' + label, { type: 'checkbox' }),
			part = schemaEditor(schema, label, {});
		toggle.input.value = '';
		toggle.input.checked = false;
		part.node.hidden = true;
		part.node.disabled = true;
		toggle.input.onchange = () => {
			part.node.hidden = !toggle.input.checked;
			part.node.disabled = !toggle.input.checked;
		};
		node.append(toggle.wrap, part.node);
		return { node, read: () => (toggle.input.checked ? part.read() : undefined) };
	}
	if (schema.type === 'object' && schema.properties) {
		const node = el('fieldset');
		node.append(el('legend', label));
		const parts = {};
		for (const [key, child] of Object.entries(schema.properties)) {
			parts[key] = schemaEditor(
				child,
				human(key) + (schema.required?.includes(key) ? ' *' : ''),
				value?.[key]
			);
			node.append(parts[key].node);
		}
		return {
			node,
			read: () => {
				const out = {};
				for (const [k, part] of Object.entries(parts)) {
					const v = part.read();
					if ((v === '' || v === undefined) && !schema.required?.includes(k)) continue;
					out[k] = v;
				}
				return out;
			}
		};
	}
	if (schema.type === 'object') {
		const node = el('fieldset'),
			pairs = [];
		node.append(el('legend', label));
		const add = () => {
			const row = el('div', null, { class: 'toolbar' }),
				key = field('Work ID'),
				val = schemaEditor(
					Object.values(schema.patternProperties ?? {})[0] ?? { type: 'string' },
					'Value'
				);
			row.append(
				key.wrap,
				val.node,
				button('Remove', () => {
					row.remove();
					pairs.splice(
						pairs.findIndex((p) => p.row === row),
						1
					);
				})
			);
			pairs.push({ row, key, val });
			node.append(row);
		};
		node.append(button('Add disposition', add));
		return {
			node,
			read: () => Object.fromEntries(pairs.map((p) => [p.key.input.value, p.val.read()]))
		};
	}
	if (schema.type === 'array') {
		const node = el('fieldset'),
			items = [];
		node.append(el('legend', label));
		const add = (value) => {
			if (items.length >= (schema.maxItems ?? 50)) return;
			const part = schemaEditor(schema.items, 'Item *', value),
				row = el('div', null, { class: 'array-item' });
			row.append(
				part.node,
				button('Remove item', () => {
					row.remove();
					items.splice(items.indexOf(part), 1);
				})
			);
			items.push(part);
			node.append(row);
		};
		node.append(button('Add item', () => add()));
		for (const item of value ?? []) add(item);
		return { node, read: () => items.map((p) => p.read()) };
	}
	if (schema.type === 'boolean') {
		const f = field(label, {
			value: value ? 'true' : 'false',
			options: [
				['false', 'No'],
				['true', 'Yes']
			]
		});
		return { node: f.wrap, read: () => f.input.value === 'true' };
	}
	const f = field(label, {
		value: value ?? '',
		type: schema.type === 'integer' ? 'number' : 'text',
		multiline: (schema.maxLength ?? 0) > 1000
	});
	if (schema.maxLength) f.input.maxLength = schema.maxLength;
	f.input.required = label.endsWith(' *');
	return {
		node: f.wrap,
		read: () => (schema.type === 'integer' ? Number(f.input.value) : f.input.value)
	};
}

function mount(container, context, module) {
	const host = context.host,
		life = new ViewLifetime(context.signal),
		feature = createFeatureClient(workFeature, host);
	const root = el('main', null, { class: 'falcon-native' });
	container.append(root);
	const header = el('header'),
		heading = el('h1', names[module]),
		status = el('p', 'Loading…', { role: 'status', class: 'status' }),
		body = el('div', null, { class: 'workspace' });
	header.append(heading);
	root.append(header, status, body);
	const toolbar = el('div', null, { class: 'toolbar' });
	header.append(toolbar);
	const displayError = (error) => {
		status.textContent = message(error);
		status.setAttribute('role', 'alert');
	};
	let selected = module === 'work' && context.props?.work_id ? { id: context.props.work_id } : null,
		refresh = async () => {},
		refreshTimer,
		busy = false,
		scope = 'attention',
		agentFilter = '',
		browseType = '',
		workOffset = 0,
		query = '',
		rootId = '',
		directory = '',
		file = null,
		docDraft = null;
	let refreshAfterReconnect = false;
	const protect = async (action) => {
		if (busy || life.dead) return;
		busy = true;
		root.setAttribute('aria-busy', 'true');
		try {
			await action();
		} catch (error) {
			if (!life.dead) displayError(error);
		} finally {
			busy = false;
			root.removeAttribute('aria-busy');
			if (refreshAfterReconnect && !life.dead && host.connection.connected) {
				refreshAfterReconnect = false;
				queueMicrotask(() => protect(refresh));
			}
		}
	};
	const rpc = (action, input = {}) => {
		context.signal.throwIfAborted();
		return host.request('falcon.vault.protected', { action, input });
	};
	const request = (mod, action, input = {}, write = false) =>
		host.request(`falcon.${mod}.${write ? 'write' : 'read'}`, { action, ...input });
	const secretNodes = new Set();
	let secretRevision = 0;
	const secretTicket = () => {
		const revision = ++secretRevision;
		const valid = life.ticket();
		return () => valid() && revision === secretRevision;
	};
	const clearSecrets = () => {
		secretRevision++;
		secretNodes.forEach((n) => {
			if ('value' in n) n.value = '';
			else n.textContent = '';
		});
	};
	life.own(clearSecrets);
	const selectedFiles = new Set(),
		lastTrash = [];
	let documentSearch = '',
		documentSort = 'name',
		documentNotice = '';
	let consentUrl,
		dialog,
		vaultEpoch,
		vaultAtRest = false,
		vaultGroup =
			module === 'vault' && context.props?.entry_id
				? context.props.entry_id.split('/').slice(0, -1).join('/')
				: '',
		vaultTree = [],
		vaultQuery = '',
		vaultSelected = module === 'vault' ? (context.props?.entry_id ?? '') : '';
	function closeDialog() {
		clearSecrets();
		dialog?.dispose();
		dialog = null;
	}

	function form(title, fields, submit, { protectedEntry = false, submitLabel = 'Save' } = {}) {
		closeDialog();
		const content = el('form', null, { class: 'falcon-native' }),
			inputs = {};
		for (const [key, options] of Object.entries(fields)) {
			const f = field(options.label ?? human(key), options);
			inputs[key] = f.input;
			if (protectedEntry && options.type === 'password') {
				f.input.setAttribute('data-secret', 'entry');
				secretNodes.add(f.input);
				f.input.autocomplete = 'new-password';
			}
			content.append(f.wrap);
		}
		const error = el('p', '', { role: 'alert' }),
			save = el('button', submitLabel, { type: 'submit', class: 'primary' });
		content.append(error, save, button('Cancel', closeDialog));
		content.addEventListener('submit', async (event) => {
			event.preventDefault();
			if (save.disabled) return;
			save.disabled = true;
			try {
				const values = Object.fromEntries(Object.entries(inputs).map(([k, n]) => [k, n.value]));
				await submit(values);
				if (!life.dead) {
					closeDialog();
					await refresh();
				}
			} catch (e) {
				error.textContent = message(e);
			} finally {
				save.disabled = false;
			}
		});
		dialog = host.components.mountDialog(root, {
			label: title,
			content,
			onCancel: () => {
				if (save.disabled) return false;
				closeDialog();
			}
		});
	}
	function confirm(label, run) {
		form(label, {}, run, { submitLabel: 'Confirm' });
	}
	// Removal is the one irreversible thing here, so it asks for the entry's name rather than a
	// second button. `message` deliberately discards error text, so the match is enforced by keeping
	// the control disabled instead of by throwing.
	function confirmByName(label, name, run, { submitLabel = 'Remove entry', note = '' } = {}) {
		closeDialog();
		const content = el('form', null, { class: 'falcon-native' });
		if (note) paragraph(content, note);
		const typed = field(`Type ${name} to confirm`, {});
		typed.input.setAttribute('autocomplete', 'off');
		const error = el('p', '', { role: 'alert' }),
			save = el('button', submitLabel, { type: 'submit', class: 'danger' });
		save.disabled = true;
		typed.input.addEventListener('input', () => {
			save.disabled = typed.input.value !== name;
		});
		content.append(
			typed.wrap,
			el('p', 'Names must match exactly.', { class: 'hint' }),
			error,
			save,
			button('Cancel', closeDialog)
		);
		content.addEventListener('submit', async (event) => {
			event.preventDefault();
			if (save.disabled) return;
			save.disabled = true;
			try {
				await run();
				if (!life.dead) {
					closeDialog();
					await refresh();
				}
			} catch (e) {
				error.textContent = message(e);
				save.disabled = typed.input.value !== name;
			}
		});
		dialog = host.components.mountDialog(root, {
			label,
			content,
			onCancel: () => {
				if (save.disabled && typed.input.value === name) return false;
				closeDialog();
			}
		});
	}
	function row(record, open) {
		const b = button('', () => protect(open), 'record');
		const identity = el('span', null, { class: 'identity' });
		identity.append(
			el('span', human(record.type ?? record.provider ?? 'File'), { class: 'kind' }),
			el('strong', record.title ?? record.purpose ?? record.id ?? record.name),
			el('small', record.id ?? '')
		);
		b.append(
			identity,
			el('span', human(record.status ?? record.health ?? record.kind ?? ''), { class: 'state' })
		);
		if (record.attention?.length)
			b.append(
				el('span', record.attention.map((w) => human(w.code)).join(' · '), { class: 'attention' })
			);
		return b;
	}
	async function command(target, command, input, idempotencyKey = crypto.randomUUID(), askId) {
		await host.request('falcon.identity', {});
		await feature.invoke('work_command', {
			command,
			id: target?.id,
			expected_version: target?.version,
			idempotency_key: idempotencyKey,
			...(askId ? { ask_id: askId } : {}),
			input
		});
	}
	function semanticForm(title, schema, initial, submit, target = null) {
		closeDialog();
		const editor = schemaEditor(schema, title, initial),
			content = el('form', null, { class: 'falcon-native' }),
			error = el('p', '', { role: 'alert' }),
			save = el('button', 'Save', { type: 'submit', class: 'primary' });
		content.append(editor.node, error, save, button('Cancel', closeDialog));
		for (const [prefix, rows, idOf, labelOf] of [
			['Agent Id', host.agents?.rows ?? [], (x) => x.id, (x) => x.name ?? x.id],
			['Session Key', host.sessions?.rows ?? [], (x) => x.key, (x) => x.label ?? x.key]
		]) {
			const list = el('datalist', null, { id: 'reference-' + crypto.randomUUID() });
			for (const item of rows) {
				const id = idOf(item);
				if (id) list.append(el('option', labelOf(item), { value: id }));
			}
			for (const input of editor.node.querySelectorAll('input'))
				if (input.getAttribute('aria-label')?.startsWith(prefix))
					input.setAttribute('list', list.id);
			content.append(list);
		}
		paragraph(
			content,
			'Agent/session suggestions come from the current OpenClaw roster. Missing references are preserved, never reassigned.'
		);
		for (const input of editor.node.querySelectorAll('input')) {
			const label = input.getAttribute('aria-label') ?? '';
			const kind = label.startsWith('Milestone Id')
				? 'milestone'
				: label.startsWith('Project Id')
					? 'project'
					: label.startsWith('Area Id')
						? 'area'
						: label.startsWith('Successor Id')
							? target?.type
							: label.startsWith('Target')
								? ''
								: null;
			if (kind === null) continue;
			const list = el('datalist', null, { id: 'work-reference-' + crypto.randomUUID() }),
				help = el('p', 'Search a Work title or enter an exact existing ID.', { class: 'status' });
			input.setAttribute('list', list.id);
			input.parentElement.append(list, help);
			let timer,
				revision = 0;
			const search = async () => {
				if (!input.isConnected || life.dead) return;
				const token = ++revision;
				try {
					const response = await feature.invoke('work_list', {
						...(kind ? { type: kind } : {}),
						limit: 25,
						fields: ['id', 'type', 'title', 'project_id'],
						...(input.value ? { search: input.value } : {})
					});
					if (token !== revision || !input.isConnected || life.dead) return;
					list.replaceChildren();
					for (const item of response.items) {
						if (kind === 'milestone' && target?.project_id && item.project_id !== target.project_id)
							continue;
						list.append(el('option', item.title, { value: item.id }));
					}
					help.textContent = `${response.items.length} of ${response.total} matches; refine the title to narrow the search. Exact IDs are validated on Save.`;
				} catch {
					if (input.isConnected)
						help.textContent = 'Reference search unavailable; existing IDs are preserved.';
				}
			};
			input.addEventListener('input', () => {
				clearTimeout(timer);
				timer = setTimeout(search, 250);
			});
			queueMicrotask(search);
		}

		const recovery = el('div', null, { class: 'toolbar' });
		recovery.hidden = true;
		if (target)
			recovery.append(
				button('Review current record', async () => {
					try {
						const latest = await request('work', 'get', { id: target.id });
						if (life.dead) return;
						detailText(content, 'Latest saved record', latest);
						recovery.append(
							button('Use current version for this draft', () => {
								target.version = latest.version;
								error.textContent =
									'Your draft is unchanged. Review its referenced versions before saving.';
							})
						);
					} catch (e) {
						error.textContent = message(e);
					}
				})
			);
		content.append(recovery);

		content.onsubmit = async (e) => {
			e.preventDefault();
			if (save.disabled) return;
			save.disabled = true;
			try {
				await submit(editor.read());
				if (!life.dead) {
					closeDialog();
					await refresh();
				}
			} catch (e) {
				error.textContent = message(e);
				recovery.hidden = false;
			} finally {
				save.disabled = false;
			}
		};
		dialog = host.components.mountDialog(root, {
			label: title,
			content,
			onCancel: () => {
				if (save.disabled) return false;
				closeDialog();
			}
		});
	}
	function commandForm(target, name) {
		const nonce = crypto.randomUUID();
		const initial = { ...target, ...(target?.definition?.content ?? {}) };
		semanticForm(
			human(name),
			commandInputs[name],
			initial,
			(input) => command(target, name, input, nonce),
			target
		);
	}
	function createWork() {
		form(
			'Choose work type',
			{
				type: {
					options: ['task', 'project', 'area', 'question', 'finding', 'decision', 'milestone']
				}
			},
			async (v) => {
				setTimeout(() => {
					if (life.dead) return;
					const schema = commandInputs.create.anyOf.find((s) => s.properties.type.const === v.type);
					const nonce = crypto.randomUUID();
					semanticForm('Create ' + human(v.type), schema, { type: v.type }, (input) =>
						command(null, 'create', input, nonce)
					);
				});
			}
		);
	}

	async function workDetail(id) {
		const valid = life.ticket(),
			record = await request('work', 'get', { id });
		if (!valid()) return;
		selected = record;
		body.replaceChildren();
		const back = button('Back to work', () =>
			protect(() => {
				selected = null;
				return refresh();
			})
		);
		body.append(
			back,
			el('h2', record.title),
			el('p', `${human(record.type)} · ${human(record.status)}`, { class: 'status' })
		);
		if (record.truncation?.truncated) {
			paragraph(
				body,
				'Some saved text is shortened in this view. Read the full saved content before making a decision.',
				'attention'
			);
			body.append(
				button('Read full saved content', () =>
					protect(async () => {
						const full = await request('work', 'get', { id, full: true });
						if (!valid()) return;
						const disclosure = el('details');
						disclosure.open = true;
						disclosure.append(
							el(
								'summary',
								'Full saved content — includes historical artifacts; not all are current applicable proof'
							)
						);
						detailText(disclosure, 'Saved record', full);
						body.append(disclosure);
						for (const [collection, page] of Object.entries(full.pages ?? {}))
							if (page.next_offset !== null)
								collectionPager(collection, page.next_offset, disclosure);
					})
				)
			);
		}
		function collectionPager(collection, offset, parent = body) {
			const load = button('Load more ' + human(collection).toLowerCase(), () =>
				protect(async () => {
					const page = await request('work', 'related', {
						id,
						collection,
						query: { offset, limit: 25 }
					});
					if (!valid()) return;
					detailText(parent, human(collection) + ' (continued)', page.items);
					offset = page.next_offset;
					load.hidden = offset === null;
				})
			);
			parent.append(load);
		}
		for (const warning of record.attention ?? [])
			paragraph(
				body,
				human(warning.code) + (warning.waiting_for ? `: ${warning.waiting_for}` : ''),
				'attention'
			);
		if (record.type === 'question')
			for (const key of ['prompt', 'context', 'impact', 'answerable_by'])
				detailText(body, human(key), record[key]);
		if (record.type === 'finding')
			for (const key of ['conclusion', 'confidence', 'targets'])
				detailText(body, human(key), record[key]);
		if (record.type === 'task')
			detailText(
				body,
				'Accountable agent',
				record.agent_id
					? {
							id: record.agent_id,
							availability: host.agents?.rows?.some((a) => a.id === record.agent_id)
								? 'Present in current Gateway roster'
								: 'Not present in the current Gateway roster; identity preserved'
						}
					: 'Unassigned'
			);
		if (record.project_id)
			body.append(button('Open project', () => protect(() => workDetail(record.project_id))));
		for (const key of [
			'description',
			'done_when',
			'success_condition',
			'achievement',
			'definition',
			'plan',
			'result',
			'change',
			'authorization',
			'wait',
			'review_target',
			'answer',
			'package',
			'outcome',
			'hypothesis',
			'sources',
			'links',
			'milestones'
		])
			if (record[key] != null) detailText(body, human(key), record[key]);
		detailText(body, 'Participants (event/session provenance)', record.participants);
		for (const child of record.associated_work ?? [])
			body.append(row(child, () => workDetail(child.id)));
		for (const ask of record.asks ?? []) {
			const section = el('section', null, { class: 'list-zone' });
			section.append(el('h2', ask.prompt));
			detailText(section, 'Missing requirement', ask.requirement);
			if (commandInputs[ask.intended_command])
				section.append(
					button('Resolve request', () => {
						const nonce = crypto.randomUUID();
						semanticForm(
							'Resolve request: ' + human(ask.intended_command),
							commandInputs[ask.intended_command],
							{ ...record, ...(record.definition?.content ?? {}) },
							(input) => command(record, ask.intended_command, input, nonce, ask.id),
							record
						);
					})
				);

			if (ask.thread)
				section.append(
					button('Open conversation', () =>
						host.sessions.open({ sessionKey: ask.thread.session_key, agentId: ask.thread.agent_id })
					)
				);
			body.append(section);
		}
		for (const relationship of record.relationships ?? []) {
			const other = relationship.source === id ? relationship.target : relationship.source;
			body.append(
				button(`${human(relationship.kind)} · ${other}`, () => protect(() => workDetail(other)))
			);
		}
		const actions = el('div', null, { class: 'toolbar' });
		body.append(actions);
		const common = ['ask', 'dismiss_ask', 'place'];
		const domain = {
			task: [
				'ready',
				'unready',
				'start',
				'wait',
				'resume',
				'complete',
				'reopen',
				'assign',
				'revise_definition',
				'revise_plan',
				'checkpoint',
				'revise_change',
				'authorize',
				'depends_on',
				'remove_dependency',
				'reaffirm_dependency',
				'review_target',
				'associate',
				'dissociate',
				'reaffirm_plan',
				'revoke_authorization',
				'abandon'
			],
			project: ['abandon', 'resume'],
			milestone: ['achieve', 'reopen'],
			question: ['edit_question', 'answer', 'hypothesis', 'reopen', 'withdraw'],
			finding: ['retract', 'supersede'],
			decision: ['decide', 'revise_decision', 'supersede_decision', 'defer', 'resume', 'withdraw'],
			area: ['edit_area', 'archive', 'restore']
		};
		const choose = field('Action', {
			options: [
				['', 'Choose an action'],
				...[...(domain[record.type] ?? []), ...common]
					.filter((n) => commandInputs[n])
					.map((n) => [n, human(n)])
			]
		});
		actions.append(choose.wrap);
		choose.input.onchange = () => {
			if (choose.input.value) commandForm(record, choose.input.value);
		};

		for (const [collection, page] of Object.entries(record.pages ?? {}))
			if (page.next_offset !== null) collectionPager(collection, page.next_offset);
		let historyOffset = 0;
		const historySection = el('section');
		const loadHistory = button('Load history', () =>
			protect(async () => {
				const data = await request('work', 'history', {
					id,
					query: { limit: 25, offset: historyOffset }
				});
				if (!valid()) return;
				detailText(historySection, historyOffset ? 'More history' : 'History', data.items);
				historyOffset = data.next_offset;
				loadHistory.textContent = 'Load more history';
				loadHistory.hidden = historyOffset === null;
			})
		);
		actions.append(loadHistory);
		body.append(historySection);

		status.textContent = 'Current record';
	}
	async function work() {
		if (selected) return workDetail(selected.id);
		const valid = life.ticket();
		const input = {
			limit: 50,
			offset: workOffset,
			...(agentFilter ? { agent_id: agentFilter } : {}),
			...(scope === 'browse' && browseType ? { type: browseType } : {}),
			...(query ? { search: query } : {}),
			...(scope === 'projects' ? { type: 'project' } : {})
		};
		const data =
			scope === 'attention'
				? await feature.invoke('work_queue', {
						limit: 15,
						...(agentFilter ? { agent_id: agentFilter } : {})
					})
				: await feature.invoke('work_list', input);
		if (!valid()) return;
		body.replaceChildren();
		if (data.buckets) {
			for (const [name, bucket] of Object.entries(data.buckets)) {
				if (!bucket.items.length) continue;
				const section = el('section', null, { class: 'list-zone' });
				section.append(el('h2', human(name)));
				for (const item of bucket.items) section.append(row(item, () => workDetail(item.id)));
				const total = bucket.total ?? bucket.items.length;
				paragraph(section, `Showing ${bucket.items.length} of ${total}.`, 'status');
				if (total > bucket.items.length) {
					let offset = bucket.next_offset ?? bucket.items.length;
					const more = button('Load more ' + human(name).toLowerCase(), () =>
						protect(async () => {
							const page = await feature.invoke('work_queue', {
								limit: 15,
								offset,
								...(agentFilter ? { agent_id: agentFilter } : {})
							});
							if (!valid()) return;
							const next = page.buckets[name];
							for (const item of next.items) section.append(row(item, () => workDetail(item.id)));
							offset = next.next_offset;
							more.hidden = offset === null;
						})
					);
					section.append(more);
				}

				body.append(section);
			}
			if (!body.children.length) paragraph(body, 'Nothing needs attention.');
		} else {
			for (const item of data.items) body.append(row(item, () => workDetail(item.id)));
			if (!data.items.length) paragraph(body, 'No matching work.');
			if (workOffset > 0)
				body.append(
					button('Previous page', () =>
						protect(async () => {
							workOffset = Math.max(0, workOffset - 50);
							await refresh();
						})
					)
				);
			if (data.next_offset !== null && data.next_offset !== undefined)
				body.append(
					button('Next page', () =>
						protect(async () => {
							workOffset = data.next_offset;
							await refresh();
						})
					)
				);
			paragraph(
				body,
				`Showing ${data.items.length} of ${data.total ?? data.items.length} matching records.`,
				'status'
			);
		}
		status.textContent = 'Up to date';
	}
	const FIELD_LABELS = { password: 'Password', username: 'Username', url: 'URL', notes: 'Notes' };
	// The order a person reads them in, not the order the record happens to carry.
	const FIELD_ORDER = ['password', 'username', 'url', 'notes'];
	// A revealed value is held only briefly; this is the shipped duration and stays unchanged.
	const SECRET_HOLD_MS = 15000;
	const leafName = (id) => (id.includes('/') ? id.split('/').pop() : id);
	const parentOf = (id) => id.split('/').slice(0, -1).join('/');
	async function vault() {
		const valid = life.ticket();
		clearSecrets();
		const state = await request('vault', 'status');
		if (!valid()) return;
		body.replaceChildren();
		vaultEpoch = state.epoch;
		// The plugin provisions and opens its one Vault as it starts, so there is nothing here for an
		// operator to create or unlock. At rest means that startup failed, and the page says so instead
		// of offering a step that is not theirs to run.
		vaultAtRest = state.locked || state.initialized === false;
		status.textContent = vaultAtRest ? 'Vault unavailable' : 'Vault ready';
		if (vaultAtRest) {
			paragraph(
				body,
				'Protected storage did not start with the plugin. Check the gateway service health for the Vault failure; credentials stay unreadable until it starts cleanly.'
			);
			return;
		}
		// The whole tree in one call. Retrieval is this page's job: past a couple of dozen entries a
		// person searches far more often than they browse, and searching cannot walk group by group.
		const listing = await rpc('inventory_all');
		if (!valid()) return;
		vaultTree = listing.entries ?? [];
		const allEntries = vaultTree.filter((e) => e.kind === 'entry').map((e) => e.id),
			allGroups = vaultTree.filter((e) => e.kind === 'group').map((e) => e.id);
		allEntries.sort((a, b) => leafName(a).localeCompare(leafName(b)));
		allGroups.sort();
		if (vaultSelected && !allEntries.includes(vaultSelected)) vaultSelected = '';
		if (vaultGroup && !allGroups.includes(vaultGroup)) vaultGroup = '';

		const bar = el('div', null, { class: 'vault-bar' }),
			search = field('Search the vault', { value: vaultQuery });
		search.wrap.classList.add('vault-search');
		search.input.type = 'search';
		search.input.setAttribute('placeholder', `Search ${allEntries.length} entries`);
		bar.append(search.wrap);
		const workspace = el('div', null, { class: 'vault-workspace' }),
			rail = el('nav', null, { class: 'vault-rail', 'aria-label': 'Vault groups' }),
			list = el('div', null, { class: 'vault-list', role: 'list' }),
			inspector = el('aside', null, { class: 'vault-inspector' });
		workspace.append(rail, list, inspector);

		const countIn = (group) => allEntries.filter((id) => id.startsWith(group + '/')).length;
		function renderRail() {
			rail.replaceChildren();
			const select = (group) => {
				vaultGroup = group;
				vaultQuery = '';
				search.input.value = '';
				renderRail();
				renderList();
			};
			const root = button(
				`All entries ${allEntries.length}`,
				() => select(''),
				vaultGroup === '' ? 'vault-rail-item selected' : 'vault-rail-item'
			);
			root.setAttribute('aria-current', vaultGroup === '' ? 'true' : 'false');
			rail.append(root);
			for (const group of allGroups) {
				const depth = group.split('/').length - 1,
					item = button(
						'',
						() => select(group),
						vaultGroup === group ? 'vault-rail-item selected' : 'vault-rail-item'
					);
				item.style.paddingLeft = `${8 + depth * 12}px`;
				item.append(
					el('span', leafName(group), { class: 'vault-rail-name' }),
					el('span', String(countIn(group)), { class: 'vault-rail-count' })
				);
				item.setAttribute('aria-current', vaultGroup === group ? 'true' : 'false');
				rail.append(item);
			}
		}
		function visibleEntries() {
			const query = vaultQuery.trim().toLowerCase();
			// Searching is global on purpose: a person looking for a name should not have to know
			// which group it is filed under.
			if (query) return allEntries.filter((id) => id.toLowerCase().includes(query));
			return allEntries.filter((id) => parentOf(id) === vaultGroup);
		}
		function renderList() {
			list.replaceChildren();
			const shown = visibleEntries();
			if (!shown.length) {
				paragraph(
					list,
					vaultQuery.trim()
						? `No entry matches ${vaultQuery.trim()}.`
						: vaultGroup
							? 'This group has no entries.'
							: 'No credentials yet.'
				);
				if (vaultGroup && !vaultQuery.trim() && !countIn(vaultGroup))
					list.append(
						button('Remove empty group', () =>
							confirm('Remove empty group ' + vaultGroup, async () => {
								await rpc('group_remove', { id: vaultGroup, confirmed: true });
								vaultGroup = '';
							})
						)
					);
				return;
			}
			for (const id of shown) {
				const rowEl = el('div', null, { class: 'vault-row', role: 'listitem' }),
					open = button('', () => protect(() => selectEntry(id)), 'vault-row-open');
				open.append(el('span', leafName(id), { class: 'vault-row-title' }));
				const group = parentOf(id);
				open.append(el('span', group || '—', { class: 'vault-row-group' }));
				if (id === vaultSelected) rowEl.classList.add('selected');
				rowEl.append(
					open,
					button('Copy', () => protect(() => carry(id, 'password', 'copy')), 'vault-row-copy')
				);
				list.append(rowEl);
			}
		}
		// One path for reading a field, so the reveal hold and the clipboard notice cannot drift apart.
		async function carry(id, fieldName, purpose, into) {
			const ticket = secretTicket();
			let result;
			try {
				result = await rpc(purpose === 'copy' ? 'copy' : 'reveal', { id, field: fieldName });
			} catch (error) {
				const code = error?.details?.code ?? error?.error?.details?.code;
				if (code !== 'not_found') throw error;
				if (ticket())
					status.textContent = `${leafName(id)} has no ${FIELD_LABELS[fieldName] ?? fieldName} field.`;
				return;
			}
			if (!ticket() || !host.connection.connected) return;
			if (purpose === 'copy') {
				await navigator.clipboard.writeText(result.value);
				status.textContent = 'Copied. Clipboard content remains until you replace it.';
				return;
			}
			if (into) {
				into.textContent = result.value;
				setTimeout(() => {
					into.textContent = '';
				}, SECRET_HOLD_MS);
			}
		}
		async function selectEntry(id) {
			vaultSelected = id;
			clearSecrets();
			renderList();
			await renderInspector();
		}
		async function renderInspector() {
			inspector.replaceChildren();
			if (!vaultSelected) {
				paragraph(inspector, 'Select an entry to see what it holds.', 'vault-inspector-empty');
				return;
			}
			const id = vaultSelected,
				title = leafName(id),
				metadata = await request('vault', 'metadata', { id });
			if (!inspector.isConnected || life.dead || vaultSelected !== id) return;
			inspector.append(el('h2', title, { class: 'vault-inspector-title' }));
			inspector.append(el('p', id, { class: 'vault-inspector-handle' }));
			if (metadata.execution_disabled)
				inspector.append(el('p', 'Agent execution disabled', { class: 'vault-flag' }));
			const carried = new Set(metadata.fields ?? []);
			// The four KeePassXC fields always appear, so an empty one reads as "not set" rather than
			// vanishing. An agent credential carries arbitrary names of its own, so anything else the
			// record holds is listed after them; hard-coding only the four would make such an entry
			// look empty.
			const extra = [...carried].filter((name) => !FIELD_ORDER.includes(name)).sort();
			// Only the fields this entry actually carries get a control. Offering Reveal for an absent
			// field hands the operator something that can only fail.
			for (const name of [...FIELD_ORDER, ...extra]) {
				const fieldRow = el('div', null, { class: 'vault-field' });
				const label = FIELD_LABELS[name] ?? name;
				fieldRow.append(el('span', label, { class: 'vault-field-label' }));
				if (!carried.has(name)) {
					fieldRow.append(
						el('span', '—', { class: 'vault-field-value empty' }),
						el('span', 'not set', { class: 'vault-field-actions empty' })
					);
					inspector.append(fieldRow);
					continue;
				}
				const shown = el('output', '', {
					class: 'vault-field-value',
					'data-secret': 'revealed',
					'aria-label': `Revealed ${label} for ${title}`
				});
				secretNodes.add(shown);
				const masked = el('span', '••••••••••', { class: 'vault-field-value masked' }),
					actions = el('div', null, { class: 'vault-field-actions' });
				// One toggle, not a Reveal button beside a Hide button: when a value is hidden, Hide
				// does nothing, and when it is shown, Reveal does nothing.
				const toggle = button('Reveal', () =>
					protect(async () => {
						if (shown.textContent) {
							clearSecrets();
							toggle.textContent = 'Reveal';
							masked.hidden = false;
							shown.hidden = true;
							return;
						}
						await carry(id, name, 'reveal', shown);
						if (!shown.textContent) return;
						toggle.textContent = 'Hide';
						masked.hidden = true;
						shown.hidden = false;
						setTimeout(() => {
							if (!shown.textContent) {
								toggle.textContent = 'Reveal';
								masked.hidden = false;
								shown.hidden = true;
							}
						}, SECRET_HOLD_MS + 100);
					})
				);
				shown.hidden = true;
				actions.append(
					toggle,
					button('Copy', () => protect(() => carry(id, name, 'copy')))
				);
				fieldRow.append(masked, shown, actions);
				inspector.append(fieldRow);
			}
			inspector.append(el('p', `Version ${metadata.version}`, { class: 'vault-inspector-meta' }));
			const footer = el('div', null, { class: 'vault-inspector-actions' });
			footer.append(
				button('Edit', () =>
					form(
						`Edit ${title}`,
						{
							password: {
								type: 'password',
								label: 'Password',
								placeholder: 'Leave blank to keep the existing secret'
							},
							username: { label: 'Username', placeholder: 'user@example.com' },
							url: { label: 'URL', placeholder: 'https://example.com' },
							notes: { label: 'Notes', placeholder: 'Optional notes' }
						},
						(v) =>
							rpc('edit_entry', {
								id,
								expected_version: metadata.version,
								fields: Object.fromEntries(
									Object.entries(v).filter(([, x]) => typeof x === 'string' && x.length)
								)
							}),
						{ protectedEntry: true }
					)
				),
				button('Move or rename', () =>
					form(
						'Rename or move credential — old handles and SecretRefs stop resolving',
						{ destination: { label: 'Destination entry path', value: id } },
						(values) =>
							rpc('relocate', {
								id,
								destination: values.destination,
								expected_version: metadata.version,
								confirmed: true
							})
					)
				),
				button(
					'Remove',
					() =>
						confirmByName(
							`Remove ${title}`,
							title,
							async () => {
								await rpc('remove_entry', {
									id,
									expected_version: metadata.version,
									confirmed: true
								});
								vaultSelected = '';
							},
							{
								note: 'This entry and its stored password are removed, and its handle stops resolving. A private recovery snapshot is taken automatically first.'
							}
						),
					'danger'
				)
			);
			inspector.append(footer);
		}

		search.input.addEventListener('input', () => {
			vaultQuery = search.input.value;
			renderList();
		});
		bar.append(
			button(
				'New entry',
				() =>
					form(
						'New entry',
						{
							id: { label: 'Title', placeholder: 'e.g. GitHub API Key' },
							group: {
								label: 'Group',
								options: [['', 'No group (vault root)'], ...allGroups.map((g) => [g, g])],
								value: vaultGroup
							},
							password: { type: 'password', label: 'Password', placeholder: 'Enter password' },
							username: { label: 'Username', placeholder: 'user@example.com' },
							url: { label: 'URL', placeholder: 'https://example.com' },
							notes: { label: 'Notes', placeholder: 'Optional notes' }
						},
						(v) =>
							rpc('add_entry', {
								id: v.group ? `${v.group}/${v.id}` : v.id,
								fields: Object.fromEntries(
									Object.entries(v).filter(
										([name, x]) =>
											!['id', 'group'].includes(name) && typeof x === 'string' && x.length
									)
								)
							}),
						{ protectedEntry: true, submitLabel: 'Create entry' }
					),
				'primary'
			),
			button('New group', () =>
				form('New group', { id: { label: 'Group path' } }, (v) => rpc('group', v))
			),
			button('Recovery snapshots', () =>
				protect(async () => {
					const snapshots = await rpc('recovery_list');
					if (!valid()) return;
					const section = el('section', null, { class: 'list-zone' });
					section.append(el('h2', 'Private recovery snapshots'));
					paragraph(
						section,
						'Snapshots include the encrypted database and private unlock key. They stay in protected host storage—not browser downloads or Documents. Restore offline into a new private directory, never over a live Vault.'
					);
					detailText(
						section,
						'Available snapshots',
						snapshots.snapshots.map((item) => ({
							...item,
							created_at: formatOperatorTime(
								item.created_at ? Date.parse(item.created_at) : undefined
							)
						}))
					);
					section.append(
						button('Create private recovery snapshot', () =>
							confirm(
								'Create private recovery snapshot including key material in protected host storage',
								() => rpc('backup')
							)
						)
					);
					inspector.replaceChildren(section);
				})
			),
			button('Access history', () =>
				protect(async () => {
					const section = el('section');
					inspector.replaceChildren(section);
					let before;
					const more = button('Load more access history', () => protect(load));
					section.append(more);
					async function load() {
						const result = await rpc('audit', { limit: 25, ...(before ? { before } : {}) });
						if (!section.isConnected || life.dead) return;
						detailText(
							section,
							'Redacted access history',
							result.entries.map((item) => ({ ...item, at: formatOperatorTime(item.at) }))
						);
						before = result.next_before;
						more.hidden = before === null;
					}
					await load();
				})
			),
			// Hand-typed grant IDs are not a browsing surface, but they are the only way to authorize
			// a SecretRef, so the control stays available rather than being dropped.
			button('SecretRef grants', () =>
				form(
					'Exact managed SecretRef grants',
					{
						ids: { multiline: true, label: 'Exact entries/<handle>/<field> IDs (one per line)' },
						operation: {
							options: [
								['grant', 'Grant'],
								['revoke', 'Revoke']
							]
						}
					},
					(values) =>
						rpc(values.operation === 'grant' ? 'grant_refs' : 'revoke_refs', {
							ids: values.ids
								.split(/\n/)
								.map((s) => s.trim())
								.filter(Boolean)
						})
				)
			)
		);
		body.append(bar, workspace);
		paragraph(body, 'Protected values stay in KeePassXC. Values are masked until you reveal them.');
		renderRail();
		renderList();
		await renderInspector();
	}
	async function integrations() {
		const valid = life.ticket(),
			data = await request('integrations', 'list');
		if (!valid()) return;
		body.replaceChildren();
		if (consentUrl)
			body.append(
				el('a', 'Open HighLevel consent', {
					href: consentUrl,
					target: '_blank',
					rel: 'noopener noreferrer'
				})
			);
		body.append(
			button(
				'Add connection',
				() =>
					form(
						'Add connection',
						{
							id: {},
							provider: { options: ['highlevel', 'cloudflare', 'schwab'] },
							purpose: {},
							vault_handle: { label: 'Vault entry path' },
							account_id: { label: 'Provider account ID' },
							actors: {
								label: 'Authorized agents/services (comma-separated)',
								value: 'service:falcon-integrations'
							}
						},
						(v) =>
							host.request('falcon.integrations.manage', {
								action: 'create',
								input: {
									...v,
									actors: v.actors
										.split(',')
										.map((s) => s.trim())
										.filter(Boolean)
								}
							})
					),
				'primary'
			)
		);
		for (const connection of data.connections) {
			const section = el('section', null, { class: 'list-zone' });
			section.append(el('h2', connection.purpose ?? connection.id));
			paragraph(
				section,
				`${human(connection.provider)} · ${human(connection.health)} · ${human(connection.freshness ?? 'validation unavailable')}`
			);
			const summary = el('dl', null, { class: 'structured-details' });
			const row = (label, value) => {
				summary.append(el('dt', label), el('dd', value));
			};
			row(
				'Maintenance',
				connection.owner === 'native'
					? 'Managed by OpenClaw'
					: connection.paused === true
						? 'Paused'
						: connection.paused === false
							? 'Enabled'
							: 'Unknown'
			);
			row('Last validated', formatOperatorTime(connection.last_success));
			row('Last failure', formatOperatorTime(connection.last_failure));
			row(
				connection.paused ? 'Stored due time; maintenance is paused' : 'Next maintenance due',
				connection.owner === 'native'
					? 'Managed by OpenClaw'
					: formatOperatorTime(connection.next_at, { missing: 'Not scheduled' })
			);
			section.append(summary);
			if (connection.guidance) paragraph(section, connection.guidance, 'status');
			if (connection.attention_work_id)
				section.append(
					button('Open connection review', () =>
						host.navigation.openPage({
							id: 'work',
							params: { work_id: connection.attention_work_id }
						})
					)
				);
			const operating = el('details');
			operating.append(el('summary', 'Account, usage and lifecycle'));
			detailText(operating, 'Account', connection.account_id ?? 'Not recorded');
			detailText(operating, 'Credential reference', connection.credential_ref ?? 'Not recorded');
			detailText(operating, 'Authorized agents/services', connection.actors ?? []);
			detailText(operating, 'Agent use', human(connection.agent_use ?? 'not_currently_validated'));
			detailText(operating, 'Credential expires', formatOperatorTime(connection.expires_at));
			detailText(
				operating,
				'Explicit renewal cutoff (not a universal provider policy)',
				formatOperatorTime(connection.reauthorize_at)
			);
			detailText(
				operating,
				'Next action',
				connection.next_action ? human(connection.next_action) : 'Not scheduled'
			);
			detailText(
				operating,
				'Failure category',
				connection.failure_code ? human(connection.failure_code) : 'Not recorded'
			);
			const portals = {
				highlevel: 'https://marketplace.gohighlevel.com/',
				cloudflare: 'https://dash.cloudflare.com/profile/api-tokens',
				schwab: 'https://developer.schwab.com/'
			};
			if (portals[connection.provider])
				operating.append(
					el('a', 'Open provider portal', {
						href: portals[connection.provider],
						target: '_blank',
						rel: 'noopener noreferrer'
					})
				);
			paragraph(
				operating,
				'Portal sign-in is not validation. Supply renewed material only through Vault, then resume and test this connection. Remote token revocation remains a provider action.'
			);
			let auditOffset = 0;
			const auditMore = button('Load connection history', () =>
				protect(async () => {
					const result = await request('integrations', 'history', {
						id: connection.id,
						query: { offset: auditOffset, limit: 25 }
					});
					if (!operating.isConnected || life.dead) return;
					for (const entry of result.entries)
						paragraph(
							operating,
							`${formatOperatorTime(entry.at)} · ${human(entry.action)} · ${human(entry.outcome)}`
						);
					auditOffset = result.next_offset;
					auditMore.hidden = auditOffset === null;
					auditMore.textContent = 'Load more connection history';
				})
			);
			operating.append(auditMore);
			section.append(operating);

			detailText(
				section,
				'Verified capabilities',
				connection.validated_capabilities?.length
					? connection.validated_capabilities
					: 'No verified capabilities'
			);
			const technical = el('details');
			technical.append(
				el('summary', 'Technical details'),
				renderValue({
					id: connection.id,
					owner: connection.owner,
					version: connection.version,
					phase: connection.phase
				})
			);
			section.append(technical);
			const actions = el('div', null, { class: 'toolbar' });
			for (const [action, label] of [
				['test', 'Test connection'],
				['refresh', 'Refresh now'],
				['pause', 'Pause maintenance'],
				['resume', 'Resume maintenance'],
				['disconnect', 'Disconnect']
			])
				if (
					(action === 'refresh' && connection.provider === 'cloudflare') ||
					(connection.owner === 'native' && action !== 'disconnect')
				)
					continue;
				else
					actions.append(
						button(label, () =>
							action === 'disconnect'
								? confirm('Disconnect this connection', () =>
										request('integrations', action, { id: connection.id }, true)
									)
								: protect(async () => {
										await request('integrations', action, { id: connection.id }, true);
										await refresh();
									})
						)
					);

			if (connection.owner === 'falcon')
				actions.append(
					button('Open credential in Vault', () =>
						host.navigation.openPage({
							id: 'vault',
							params: { entry_id: connection.credential_ref?.handle ?? '' }
						})
					),
					button('Change credential binding', () =>
						form(
							'Bind an existing Vault entry; maintenance stays paused and unvalidated',
							{
								vault_handle: {
									label: 'Vault entry path',
									value: connection.credential_ref?.handle ?? ''
								}
							},
							(values) =>
								host.request('falcon.integrations.manage', {
									action: 'rebind',
									input: {
										connection_id: connection.id,
										expected_version: connection.version,
										vault_handle: values.vault_handle
									}
								})
						)
					)
				);
			if (connection.disconnected || connection.health === 'reauthorization_required')
				actions.append(
					button('Prepare reconnection', () =>
						confirm(
							'Prepare reconnection after reviewing renewed Vault credentials; maintenance stays paused and unvalidated',
							() =>
								host.request('falcon.integrations.manage', {
									action: 'reconnect',
									input: { connection_id: connection.id, expected_version: connection.version }
								})
						)
					)
				);
			if (connection.provider === 'highlevel')
				actions.append(
					button('Authorize HighLevel', () =>
						form(
							'Begin HighLevel consent',
							{
								redirect_uri: { label: 'Approved callback URI' },
								scopes: { label: 'Scopes (space-separated)', value: 'locations.readonly' }
							},
							async (v) => {
								const result = await host.request('falcon.integrations.manage', {
									action: 'consent',
									input: {
										connection_id: connection.id,
										redirect_uri: v.redirect_uri,
										scopes: v.scopes.split(/\s+/).filter(Boolean)
									}
								});
								const url = new URL(result.authorization_url);
								if (url.origin !== 'https://marketplace.gohighlevel.com')
									throw Error('Unexpected consent destination');
								consentUrl = url.href;
								const link = el('a', 'Open HighLevel consent', {
									href: url.href,
									target: '_blank',
									rel: 'noopener noreferrer'
								});
								section.append(link);
								status.textContent =
									'Consent link ready. Sign-in is not proof of successful validation.';
							}
						)
					),
					button('Finish HighLevel consent', () =>
						form(
							'Finish HighLevel consent',
							{
								state: { type: 'password', label: 'Returned OAuth state' },
								code: { type: 'password', label: 'Authorization code' }
							},
							(v) => host.request('falcon.integrations.manage', { action: 'complete', input: v }),
							{ protectedEntry: true }
						)
					)
				);
			section.append(actions);
			body.append(section);
		}
		if (!data.connections.length)
			paragraph(
				body,
				'No connections configured. Live provider authorization requires consent; fixture proof is not a live connection.'
			);
		status.textContent = 'Connection health from the server';
	}
	async function documents() {
		const valid = life.ticket();
		if (!rootId) {
			const data = await request('documents', 'roots');
			if (!valid()) return;
			body.replaceChildren();
			for (const item of data.roots ?? data) {
				body.append(
					button(item.id, () =>
						protect(async () => {
							selectedFiles.clear();
							rootId = item.id;
							directory = '';
							await refresh();
						})
					)
				);
			}
			status.textContent = 'Choose a workspace';
			return;
		}
		const input = { root_id: rootId, path: directory, search: documentSearch, sort: documentSort };
		if (file) {
			const data =
				docDraft ?? (await request('documents', 'read', { root_id: rootId, path: file }));
			if (!valid()) return;
			body.replaceChildren(
				button('Back to folder', () =>
					protect(async () => {
						if (docDraft)
							return confirm('Discard unsaved changes', async () => {
								docDraft = null;
								file = null;
							});
						file = null;
						await refresh();
					})
				),
				el('h2', file)
			);
			const edit = field('Document content', { multiline: true, value: data.content });
			edit.input.classList.add('document-editor');
			edit.input.oninput = () => {
				docDraft = { content: edit.input.value, version: data.version };
			};
			body.append(edit.wrap);
			const preview = el('iframe', null, {
				title: 'Sandboxed Markdown preview',
				sandbox: '',
				class: 'document-preview'
			});
			const renderPreview = () => {
				preview.srcdoc = documentPreview(edit.input.value);
			};
			body.append(
				button('Preview Markdown', () => {
					renderPreview();
					preview.hidden = !preview.hidden;
				}),
				preview
			);
			preview.hidden = true;
			const actions = el('div', null, { class: 'toolbar' });
			actions.append(
				button('Compare latest version', () =>
					protect(async () => {
						const current = await request('documents', 'read', { root_id: rootId, path: file });
						if (life.dead) return;
						detailText(body, 'Latest saved content', current.content);
						body.append(
							button('Use latest version for next save', () => {
								data.version = current.version;
								if (docDraft) docDraft.version = current.version;
								status.textContent =
									'Your edits remain. The next Save will replace the reviewed latest version.';
							})
						);
					})
				)
			);
			actions.append(
				button(
					'Save',
					() =>
						protect(async () => {
							await request(
								'documents',
								'write',
								{
									root_id: rootId,
									path: file,
									content: edit.input.value,
									expected_version: data.version
								},
								true
							);
							docDraft = null;
							await refresh();
						}),
					'primary'
				),
				button('Download', () => {
					const url = URL.createObjectURL(new Blob([edit.input.value], { type: 'text/plain' })),
						a = el('a', null, { href: url, download: file.split('/').pop() });
					a.click();
					setTimeout(() => URL.revokeObjectURL(url), 1000);
				}),
				button('Copy path', () =>
					protect(async () => {
						const result = await request('documents', 'copy_path', { root_id: rootId, path: file });
						await navigator.clipboard.writeText(result.path);
					})
				),
				button('Rename', () =>
					form('Rename file', { destination: { value: file } }, (v) =>
						request(
							'documents',
							'rename',
							{
								root_id: rootId,
								path: file,
								destination: v.destination,
								expected_version: data.version
							},
							true
						).then(() => {
							file = v.destination;
							// Rename moves the saved file; preserve unsaved content and its reviewed version.
						})
					)
				),
				button('Move to trash', () =>
					confirm(`Move ${file} to trash`, async () => {
						const result = await request(
							'documents',
							'trash',
							{ root_id: rootId, path: file, expected_version: data.version, confirmed: true },
							true
						);
						lastTrash.push({ root_id: rootId, trash_id: result.trash_id, name: file });
						file = null;
						docDraft = null;
						status.textContent = 'Moved to trash; Undo is available in the folder.';
					})
				)
			);
			body.append(actions);
			status.textContent = docDraft
				? 'Unsaved changes'
				: 'Text view · document contents cannot execute scripts';
			return;
		}
		const data = await request('documents', 'list', input);
		if (!valid()) return;
		body.replaceChildren();
		const breadcrumbs = el('nav', null, { 'aria-label': 'Breadcrumbs' });
		breadcrumbs.append(
			button('Workspaces', () =>
				protect(async () => {
					selectedFiles.clear();
					rootId = '';
					await refresh();
				})
			),
			button(`${rootId} / ${directory || 'Root'}`, () =>
				protect(async () => {
					selectedFiles.clear();
					directory = directory.split('/').slice(0, -1).join('/');
					await refresh();
				})
			)
		);
		body.append(breadcrumbs);
		const actions = el('div', null, { class: 'toolbar' });
		actions.append(
			button('New file', () =>
				form('New file', { name: {}, content: { multiline: true } }, (v) =>
					request(
						'documents',
						'write',
						{
							root_id: rootId,
							path: [directory, v.name].filter(Boolean).join('/'),
							content: v.content,
							expected_version: null
						},
						true
					)
				)
			),
			button('New folder', () =>
				form('New folder', { name: {} }, (v) =>
					request(
						'documents',
						'mkdir',
						{ root_id: rootId, path: [directory, v.name].filter(Boolean).join('/') },
						true
					)
				)
			)
		);

		const search = field('Search filenames', { value: documentSearch }),
			sort = field('Sort', {
				value: documentSort,
				options: [
					['name', 'Name A–Z'],
					['name_desc', 'Name Z–A']
				]
			});
		search.input.onchange = () =>
			protect(async () => {
				documentSearch = search.input.value;
				await refresh();
			});
		sort.input.onchange = () =>
			protect(async () => {
				documentSort = sort.input.value;
				await refresh();
			});
		actions.append(search.wrap, sort.wrap);
		actions.append(
			button('Trash selected files', () => {
				const targets = [...selectedFiles],
					chosenRoot = rootId;
				if (!targets.length) {
					status.textContent = 'Select files first.';
					return;
				}
				confirm(`Move these files to trash: ${targets.join(', ')}`, async () => {
					const outcomes = [];
					for (const name of targets) {
						try {
							context.signal.throwIfAborted();
							const current = await request('documents', 'read', {
								root_id: chosenRoot,
								path: name
							});
							const result = await request(
								'documents',
								'trash',
								{
									root_id: chosenRoot,
									path: name,
									expected_version: current.version,
									confirmed: true
								},
								true
							);
							lastTrash.push({ root_id: chosenRoot, trash_id: result.trash_id, name });
							selectedFiles.delete(name);
							outcomes.push({ name, moved: true });
						} catch {
							outcomes.push({ name, moved: false });
						}
					}
					documentNotice = outcomes.every((r) => r.moved)
						? 'Selected files moved to trash.'
						: 'Some selected files were not moved; the remaining selection is preserved.';
				});
			})
		);

		actions.append(
			button('Browse trash', () =>
				protect(async () => {
					const trashRoot = rootId;
					const trash = el('section', null, { class: 'list-zone' });
					trash.append(el('h2', 'Recoverable trash'));
					body.append(trash);
					let offset = 0;
					const more = button('Load more trash', () => protect(load));
					async function load() {
						const result = await request('documents', 'trash_list', {
							root_id: trashRoot,
							offset,
							limit: 50
						});
						if (!trash.isConnected || life.dead) return;
						for (const item of result.entries) {
							const line = el('div', null, { class: 'toolbar' });
							line.append(
								el('span', item.path),
								button('Restore ' + item.path, () =>
									confirm(
										'Restore ' + item.path + ' without overwriting any current file',
										async () => {
											await request(
												'documents',
												'restore',
												{ root_id: trashRoot, trash_id: item.trash_id },
												true
											);
										}
									)
								)
							);
							trash.append(line);
						}
						if (!result.total) paragraph(trash, 'Trash is empty.');
						if (result.unavailable)
							paragraph(
								trash,
								`${result.unavailable} items are unavailable or failed integrity checks.`,
								'attention'
							);
						offset = result.next_offset;
						more.hidden = offset === null;
					}
					trash.append(more);
					await load();
				})
			)
		);
		for (const saved of lastTrash)
			actions.append(
				button(`Undo trash: ${saved.name}`, () =>
					protect(async () => {
						await request(
							'documents',
							'restore',
							{ root_id: saved.root_id, trash_id: saved.trash_id },
							true
						);
						lastTrash.splice(lastTrash.indexOf(saved), 1);
						await refresh();
					})
				)
			);
		const upload = field('Upload text file', { type: 'file' });
		upload.input.onchange = () =>
			protect(async () => {
				const source = upload.input.files?.[0];
				if (!source) return;
				if (source.size > 262144) throw Error('too_large');
				await request(
					'documents',
					'upload',
					{
						root_id: rootId,
						path: [directory, source.name].filter(Boolean).join('/'),
						content: await source.text(),
						expected_version: null
					},
					true
				);
				await refresh();
			});
		actions.append(upload.wrap);
		body.append(actions);
		for (const entry of data.entries) {
			const next = [directory, entry.name].filter(Boolean).join('/'),
				line = el('div', null, { class: 'file-row' });
			if (entry.kind === 'file') {
				const select = el('input', null, {
					type: 'checkbox',
					'aria-label': `Select ${entry.name}`
				});
				select.checked = selectedFiles.has(next);
				select.onchange = () => {
					if (select.checked && selectedFiles.size < 20) selectedFiles.add(next);
					else {
						selectedFiles.delete(next);
						select.checked = false;
					}
				};
				line.append(select);
			}
			line.append(
				row(entry, async () => {
					if (entry.kind === 'directory') {
						directory = next;
						selectedFiles.clear();
					} else file = next;
					await refresh();
				})
			);
			body.append(line);
		}

		if (!data.entries.length) paragraph(body, 'This folder is empty.');
		status.textContent = documentNotice || 'Authorized workspace';
	}
	refresh = () => {
		status.setAttribute('role', 'status');
		return { work, integrations, vault, documents }[module]();
	};
	toolbar.append(button('Refresh', () => protect(refresh)));
	if (module === 'work') {
		for (const [id, label] of [
			['attention', 'Needs attention'],
			['projects', 'Projects'],
			['browse', 'Browse']
		])
			toolbar.append(
				button(label, () =>
					protect(async () => {
						scope = id;
						workOffset = 0;
						selected = null;
						await refresh();
					})
				)
			);
		toolbar.append(button('Create work', createWork, 'primary'));
		const search = field('Search work');
		search.input.onchange = () =>
			protect(async () => {
				query = search.input.value;
				workOffset = 0;
				scope = 'browse';
				selected = null;
				await refresh();
			});
		toolbar.append(search.wrap);
		const agent = field('Agent', {
				options: [
					['', 'All agents'],
					...(host.agents?.rows ?? []).map((a) => [a.id, a.name ?? a.id])
				]
			}),
			type = field('Work type', {
				options: [
					['', 'All types'],
					...['task', 'project', 'area', 'question', 'finding', 'decision', 'milestone'].map(
						(t) => [t, human(t)]
					)
				]
			});
		agent.input.onchange = () =>
			protect(async () => {
				agentFilter = agent.input.value;
				selected = null;
				workOffset = 0;
				await refresh();
			});
		type.input.onchange = () =>
			protect(async () => {
				browseType = type.input.value;
				scope = 'browse';
				selected = null;
				workOffset = 0;
				await refresh();
			});
		toolbar.append(agent.wrap, type.wrap);
	}
	let wasConnected = host.connection.connected;
	const unsubscribe = host.subscribe(() => {
		const connected = host.connection.connected;
		if (!connected || !host.connection.canWrite) {
			life.clear();
			clearSecrets();
			status.textContent = connected ? 'Read-only access' : 'Disconnected — drafts preserved';
		}
		if (connected && !wasConnected) {
			if (busy) refreshAfterReconnect = true;
			else protect(refresh);
		}
		wasConnected = connected;
	});
	const events =
		module === 'work'
			? host.onEvent('falcon_work_changed', () => {
					status.textContent = 'Work changed. Refresh to review the latest version.';
				})
			: () => {};
	if (module === 'vault') {
		refreshTimer = setInterval(async () => {
			if (life.dead || !host.connection.connected) return;
			try {
				const state = await request('vault', 'status');
				if (
					state.locked ||
					state.can_manage === false ||
					(vaultEpoch !== undefined && state.epoch !== vaultEpoch)
				) {
					life.clear();
					clearSecrets();
					if (!vaultAtRest) protect(refresh);
				}
			} catch {
				clearSecrets();
			}
		}, 1000);
	}
	protect(async () => {
		const available = await host.request('falcon.ui.status', {});
		if (!available.modules.includes(module)) {
			status.textContent = 'This module is disabled in the plugin configuration.';
			return;
		}
		await refresh();
	});
	return {
		dispose() {
			closeDialog();
			life.dispose();
			unsubscribe();
			events();
			clearInterval(refreshTimer);
			root.remove();
		},
		update(next) {
			if (!next.presented) life.clear();
		},
		focus() {
			heading.tabIndex = -1;
			heading.focus();
		}
	};
}
export default defineControlUiPlugin({
	id: 'falcon-dash',
	activate(host) {
		const disposers = [];
		for (const [id, label] of Object.entries(names)) {
			disposers.push(
				host.ui.registerPage({
					id,
					label,
					mount: (container, context) => mount(container, context, id)
				})
			);
			disposers.push(
				host.ui.registerNavigation({ id, label, page: { id }, order: 40 + disposers.length })
			);
		}
		return () => disposers.reverse().forEach((dispose) => dispose());
	}
});
