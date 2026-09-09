import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const owner = 'owner@fixture.invalid';
async function openModule(page: Page, name: string) {
	await page.goto(`/plugin?plugin=falcon-dash&id=${name.toLowerCase()}`);
	await expect(
		page.locator('.falcon-native').getByRole('heading', { name, exact: true })
	).toBeVisible();
	await expect(page.locator('.falcon-native').first()).not.toHaveAttribute('aria-busy', 'true');
	const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true });
	if (await drawer.isVisible()) {
		await page.keyboard.press('Escape');
		await expect(drawer).not.toBeVisible();
	}
}

async function capture(page: Page, name: string, project: string) {
	await expect(page.locator('.falcon-native').first()).not.toHaveAttribute('aria-busy', 'true');
	const dir = 'artifacts/plugin-v4/native-screenshots';
	fs.mkdirSync(dir, { recursive: true });
	await page.screenshot({
		path: path.join(dir, `${project}-${name}.png`),
		fullPage: true,
		mask: [page.locator('[data-secret]')]
	});
	const layout = await page
		.locator('.falcon-native')
		.first()
		.evaluate((element) => ({
			scrollWidth: element.scrollWidth,
			clientWidth: element.clientWidth
		}));
	expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
}
async function vaultReady(page: Page) {
	// The plugin provisions and opens the Vault at startup, so credential management is the first
	// thing an operator sees. There is no unlock step to perform here.
	await expect(
		page.locator('.falcon-native').getByRole('button', { name: 'New entry', exact: true })
	).toBeVisible();
}
// One row per entry in the list; every field control lives in the inspector that a row opens.
function vaultRow(page: Page, title: string) {
	return page.locator('.vault-row').filter({ has: page.getByText(title, { exact: true }) });
}
async function openVaultEntry(page: Page, title: string) {
	await vaultRow(page, title).getByRole('button', { name: title }).click();
	await expect(page.locator('.vault-inspector-title')).toHaveText(title);
}
// A field row is label / value / actions on one baseline, so the label identifies the row.
function vaultField(page: Page, label: string) {
	return page
		.locator('.vault-field')
		.filter({ has: page.locator('.vault-field-label').getByText(label, { exact: true }) });
}
async function selectVaultGroup(page: Page, name: string) {
	await page
		.locator('.vault-rail-item')
		.filter({ has: page.getByText(name, { exact: true }) })
		.click();
}
test.afterEach(async ({ page, request }, info) => {
	if (info.status !== info.expectedStatus) {
		const dir = 'artifacts/plugin-v4/native-screenshots';
		fs.mkdirSync(dir, { recursive: true });
		await page
			.screenshot({
				path: path.join(
					dir,
					`${info.project.name}-failure-${info.title.replace(/[^a-z0-9]/gi, '-')}.png`
				),
				fullPage: true,
				mask: [page.locator('[data-secret]')]
			})
			.catch(() => {});
	}
	await request.post('/__fixture/reconnect');
	await request.post('/__fixture/identity', { data: { email: owner } });
});
test('real Gateway native Work renders and commits schema-backed edits', async ({ page }, info) => {
	await openModule(page, 'Work');
	await capture(page, 'work-attention', info.project.name);
	await page
		.locator('.falcon-native')
		.getByRole('button', { name: 'Create work', exact: true })
		.click();
	let dialog = page.locator('openclaw-modal-dialog');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	dialog = page.locator('openclaw-modal-dialog');
	await dialog
		.getByLabel('Title *', { exact: true })
		.fill(`Native acceptance ${info.project.name}`);
	await dialog
		.getByLabel('Description *', { exact: true })
		.fill('Created by the actual signed-in native page.');
	await dialog
		.getByLabel('Done When *', { exact: true })
		.fill('The real Gateway stores this Task and it remains after reload.');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('openclaw-modal-dialog')).toHaveCount(0);
	await page.locator('.falcon-native').getByRole('button', { name: 'Browse', exact: true }).click();
	await page
		.locator('.falcon-native')
		.getByLabel('Search work')
		.fill(`Native acceptance ${info.project.name}`);
	await page.locator('.falcon-native').getByLabel('Search work').press('Tab');
	await expect(
		page.locator('.record').filter({ hasText: `Native acceptance ${info.project.name}` })
	).toBeVisible();
	await page
		.locator('.record')
		.filter({ hasText: `Native acceptance ${info.project.name}` })
		.click();
	await capture(page, 'task-detail', info.project.name);
	await page.reload();
	await expect(page.locator('.falcon-native')).toBeVisible();
	await openModule(page, 'Work');
	await page.locator('.falcon-native').getByRole('button', { name: 'Browse', exact: true }).click();
	await page.getByLabel('Search work').fill(`Native acceptance ${info.project.name}`);
	await page.getByLabel('Search work').press('Tab');
	await expect(
		page.locator('.record').filter({ hasText: `Native acceptance ${info.project.name}` })
	).toBeVisible();
	await page
		.locator('.record')
		.filter({ hasText: `Native acceptance ${info.project.name}` })
		.click();
	await expect(page.locator('.falcon-native')).toContainText(
		'The real Gateway stores this Task and it remains after reload.'
	);
});
test('real native Vault supports protected owner entry and agent-created reveal copy cleanup', async ({
	page
}, info) => {
	await openModule(page, 'Vault');
	await vaultReady(page);
	await page.getByRole('button', { name: 'New entry', exact: true }).click();
	const dialog = page.locator('openclaw-modal-dialog');
	await dialog.getByLabel('Title', { exact: true }).fill(`owner-${info.project.name}`);
	await dialog.getByLabel('Password', { exact: true }).fill('SYNTHETIC-HUMAN-UI-CANARY');
	await dialog.getByRole('button', { name: 'Create entry', exact: true }).click();
	await expect(page.locator('openclaw-modal-dialog')).toHaveCount(0);
	await openModule(page, 'Vault');
	await vaultReady(page);
	await openVaultEntry(page, `owner-${info.project.name}`);
	const password = vaultField(page, 'Password');
	await password.getByRole('button', { name: 'Reveal', exact: true }).click();
	await expect(password.locator('output')).toHaveText('SYNTHETIC-HUMAN-UI-CANARY');
	await page.evaluate(() => navigator.clipboard.writeText('SYNTHETIC-BEFORE-COPY'));
	await password.getByRole('button', { name: 'Copy', exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toBe('SYNTHETIC-HUMAN-UI-CANARY');
	// The same control hides it again; there is no Hide button standing idle beside Reveal.
	await password.getByRole('button', { name: 'Hide', exact: true }).click();
	await expect(password.locator('output')).toHaveText('');
	// An agent credential carries its own field names rather than a password. The inspector lists
	// whatever the record holds, so those names appear after the four KeePassXC fields.
	await openVaultEntry(page, 'agent-created');
	const apiKey = vaultField(page, 'api_key');
	await apiKey.getByRole('button', { name: 'Reveal', exact: true }).click();
	await expect(apiKey.locator('output')).toHaveText('SYNTHETIC-AGENT-UI-CANARY');
	await page.evaluate(() => navigator.clipboard.writeText('SYNTHETIC-BEFORE-COPY'));
	await apiKey.getByRole('button', { name: 'Copy', exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toBe('SYNTHETIC-AGENT-UI-CANARY');
	await capture(page, 'vault-masked', info.project.name);
	// Nothing locks the Vault while the plugin runs — only shutdown does — so there is no operator
	// lock to drive here. Revealed values clearing when the connection drops is covered separately,
	// and `plugin/tests/native-ui.test.mjs` covers the at-rest status observation.
	await expect(page.getByRole('button', { name: 'Lock Vault', exact: true })).toHaveCount(0);
});
test('native Documents saves through the Gateway and preserves stale edits', async ({
	page,
	request
}, info) => {
	await openModule(page, 'Documents');
	await page
		.locator('.falcon-native')
		.getByRole('button', { name: 'workspace', exact: true })
		.click();
	await page.locator('.record').filter({ hasText: 'Operating notes.md' }).click();
	const editor = page.getByLabel('Document content', { exact: true });
	await editor.fill(`# My preserved draft ${info.project.name}\nReview this before saving.\n`);
	await request.post('/__fixture/document');
	await page.locator('.falcon-native').getByRole('button', { name: 'Save', exact: true }).click();
	await expect(editor).toHaveValue(new RegExp(`My preserved draft ${info.project.name}`));
	await expect(page.locator('.falcon-native [role=alert]')).toBeVisible();
	await page.getByRole('button', { name: 'Compare latest version', exact: true }).click();
	await expect(page.locator('.falcon-native')).toContainText('Changed by another writer');
	await page.getByRole('button', { name: 'Use latest version for next save', exact: true }).click();
	await page.getByRole('button', { name: 'Rename', exact: true }).click();
	const rename = page.locator('openclaw-modal-dialog');
	await rename
		.getByLabel('Destination', { exact: true })
		.fill(`Renamed notes ${info.project.name}.md`);
	await rename.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(rename).toHaveCount(0);
	await expect(editor).toHaveValue(new RegExp(`My preserved draft ${info.project.name}`));
	await capture(page, 'documents-dirty-rename', info.project.name);
	await page.locator('.falcon-native').getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.falcon-native')).toContainText('Text view');
	await page.getByRole('button', { name: 'Preview Markdown', exact: true }).click();
	await expect(
		page
			.frameLocator('iframe.document-preview')
			.getByRole('heading', { name: `My preserved draft ${info.project.name}` })
	).toBeVisible();
	await capture(page, 'documents-editor', info.project.name);
	await page.getByRole('button', { name: 'Rename', exact: true }).click();
	await page
		.locator('openclaw-modal-dialog')
		.getByLabel('Destination', { exact: true })
		.fill('Operating notes.md');
	await page
		.locator('openclaw-modal-dialog')
		.getByRole('button', { name: 'Save', exact: true })
		.click();
	await expect(page.locator('openclaw-modal-dialog')).toHaveCount(0);
	await openModule(page, 'Documents');
	await page
		.locator('.falcon-native')
		.getByRole('button', { name: 'workspace', exact: true })
		.click();
	await page.locator('.record').filter({ hasText: 'Operating notes.md' }).click();
	await expect(editor).toHaveValue(new RegExp(`My preserved draft ${info.project.name}`));
});
test('native Integrations performs real persisted maintenance controls without contacting live providers', async ({
	page
}, info) => {
	await openModule(page, 'Integrations');
	const connection = page
		.locator('.list-zone')
		.filter({ hasText: 'Synthetic connection — not live authentication' });
	await expect(connection).toBeVisible();
	await expect(
		connection
			.locator('dt')
			.filter({ hasText: /^Maintenance$/ })
			.locator('+ dd')
	).toHaveText('Paused');
	await connection.getByRole('button', { name: 'Resume maintenance', exact: true }).click();
	await expect(
		connection
			.locator('dt')
			.filter({ hasText: /^Maintenance$/ })
			.locator('+ dd')
	).toHaveText('Enabled');
	await openModule(page, 'Integrations');
	await expect(
		connection
			.locator('dt')
			.filter({ hasText: /^Maintenance$/ })
			.locator('+ dd')
	).toHaveText('Enabled');
	await expect(page.locator('.falcon-native').first()).not.toHaveAttribute('aria-busy', 'true');
	await connection.getByRole('button', { name: 'Pause maintenance', exact: true }).click();
	await expect(
		connection
			.locator('dt')
			.filter({ hasText: /^Maintenance$/ })
			.locator('+ dd')
	).toHaveText('Paused');
	await openModule(page, 'Integrations');
	await expect(
		connection
			.locator('dt')
			.filter({ hasText: /^Maintenance$/ })
			.locator('+ dd')
	).toHaveText('Paused');
	const technical = connection
		.locator('details')
		.filter({ has: page.getByText('Technical details', { exact: true }) });
	await expect(technical).toHaveJSProperty('open', false);
	const cardBox = await connection.boundingBox();
	for (const element of [connection.locator('dl').first(), technical]) {
		const box = await element.boundingBox();
		expect(box.x - cardBox.x).toBeGreaterThanOrEqual(16);
	}
	await expect(
		connection
			.locator('dt')
			.filter({ hasText: /^Stored due time/ })
			.locator('+ dd')
	).toHaveText(/20\d{2}.*\([^)]+\)/);
	await expect(
		connection
			.locator('dt')
			.filter({ hasText: /^Last validated$/ })
			.locator('+ dd')
	).toHaveText('Not recorded');
	await capture(page, 'integrations', info.project.name);
});
test('real transport disconnect clears revealed values and reconnect recovers native reads', async ({
	page,
	request
}, info) => {
	await openModule(page, 'Vault');
	await vaultReady(page);
	await openVaultEntry(page, 'agent-created');
	const apiKey = vaultField(page, 'api_key');
	await apiKey.getByRole('button', { name: 'Reveal', exact: true }).click();
	await expect(apiKey.locator('output')).toHaveText('SYNTHETIC-AGENT-UI-CANARY');
	await request.post('/__fixture/disconnect');
	await expect(page.locator('body')).not.toContainText('SYNTHETIC-AGENT-UI-CANARY');
	await request.post('/__fixture/reconnect');
	await expect(
		page.locator('.falcon-native').getByRole('button', { name: 'New entry', exact: true })
	).toBeVisible({ timeout: 60000 });
	await capture(page, 'reconnected-vault', info.project.name);
});
// Reaching an authenticated Gateway connection is the human credential for this Vault, and this
// fixture's `vaultOwners` is empty — the fresh-install case. A second operator must therefore get
// credential management, not the dead page that an owner allowlist used to produce.
test('another authenticated person reaches Vault management on a fresh install', async ({
	page,
	request
}, info) => {
	await request.post('/__fixture/identity', { data: { email: 'second@fixture.invalid' } });
	await openModule(page, 'Vault');
	await vaultReady(page);
	await expect(page.locator('.falcon-native [role=alert]')).toHaveCount(0);
	await capture(page, 'vault-second-operator', info.project.name);
});
test('Custom plugin UI off provides guidance instead of enabling native code', async ({
	page,
	request
}, info) => {
	await request.post('/__fixture/ui', { data: { enabled: false } });
	try {
		await page.goto('/plugins/falcon-dash/work');
		await expect(page.getByText(/Custom plugin UI/)).toBeVisible();
		await expect(page.locator('.falcon-native')).toHaveCount(0);
		const dir = 'artifacts/plugin-v4/native-screenshots';
		fs.mkdirSync(dir, { recursive: true });
		await page.screenshot({
			path: path.join(dir, `${info.project.name}-opt-in-off.png`),
			fullPage: true
		});
	} finally {
		await request.post('/__fixture/ui', { data: { enabled: true } });
	}
});
test('Project Milestone Decision and Ask details use the real canonical records', async ({
	page
}, info) => {
	await openModule(page, 'Work');
	const app = page.locator('.falcon-native');
	await app.getByRole('button', { name: 'Projects', exact: true }).click();
	await page
		.locator('.record')
		.filter({ hasText: 'Deliver the quarterly operations review' })
		.click();
	await capture(page, 'project-detail', info.project.name);
	await page.locator('.record').filter({ hasText: 'Review accepted' }).click();
	await expect(app).toContainText('The owner accepts the complete review.');
	await capture(page, 'milestone-detail', info.project.name);
	await app.getByRole('button', { name: 'Browse', exact: true }).click();
	await app.getByLabel('Work type', { exact: true }).selectOption('decision');
	await page.locator('.record').filter({ hasText: 'Choose the review window' }).click();
	await expect(app).toContainText('Morning review');
	await expect(app).toContainText('The final review cannot be scheduled.');
	await capture(page, 'decision-detail', info.project.name);
	await app.getByRole('button', { name: 'Browse', exact: true }).click();
	await app.getByLabel('Work type', { exact: true }).selectOption('task');
	await page.locator('.record').filter({ hasText: 'Review the migration plan' }).click();
	await expect(app).toContainText('Please review the completion criteria.');
	await capture(page, 'ask-detail', info.project.name);
	await app.getByRole('button', { name: 'Open conversation', exact: true }).click();
	await expect(page).toHaveURL(/\/chat\//);
	await expect(page.getByText('Review follow-up', { exact: true }).first()).toBeVisible();
});
test('real native Markdown preview contains hostile markup without executing it', async ({
	page
}, info) => {
	await openModule(page, 'Documents');
	await page
		.locator('.falcon-native')
		.getByRole('button', { name: 'workspace', exact: true })
		.click();
	await page.locator('.record').filter({ hasText: 'Untrusted sample.md' }).click();
	await expect(page.getByLabel('Document content', { exact: true })).toHaveValue(/documentEscaped/);
	await page.getByRole('button', { name: 'Preview Markdown', exact: true }).click();
	const preview = page.locator('iframe.document-preview');
	await expect(preview).toHaveAttribute('sandbox', '');
	await expect(
		page
			.frameLocator('iframe.document-preview')
			.getByRole('heading', { name: 'Safe heading', exact: true })
	).toBeVisible();
	await expect(page.frameLocator('iframe.document-preview').locator('script,img')).toHaveCount(0);
	expect(await page.evaluate(() => Reflect.get(window, 'documentEscaped'))).toBeUndefined();
	await capture(page, 'documents-hostile-preview', info.project.name);
});

test('native sidebar navigation opens the registered page on desktop and narrow shells', async ({
	page
}, info) => {
	await openModule(page, 'Work');
	const destination = page
		.locator('openclaw-plugin-contributions')
		.getByRole('link', { name: 'Integrations', exact: true })
		.filter({ visible: true })
		.first();
	if (!(await destination.isVisible()))
		await page
			.getByRole('button', { name: 'Expand sidebar', exact: true })
			.filter({ visible: true })
			.first()
			.click();
	await expect(destination).toBeVisible();
	await destination.click();
	await expect(
		page.locator('.falcon-native').getByRole('heading', { name: 'Integrations', exact: true })
	).toBeVisible();
	const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true });
	if (await drawer.isVisible()) {
		await page.keyboard.press('Escape');
		await expect(drawer).not.toBeVisible();
	}
	await capture(page, 'native-sidebar-navigation', info.project.name);
});

test('Work full-content recovery and paginated history are reachable in the real shell', async ({
	page
}, info) => {
	await openModule(page, 'Work');
	const app = page.locator('.falcon-native');
	await app.getByRole('button', { name: 'Browse', exact: true }).click();
	await app.getByLabel('Search work').fill('Inspect full history and saved evidence');
	await app.getByLabel('Search work').press('Tab');
	await app
		.locator('.record')
		.filter({ hasText: 'Inspect full history and saved evidence' })
		.click();
	await expect(app).toContainText('Some saved text is shortened');
	await app.getByRole('button', { name: 'Read full saved content', exact: true }).click();
	await expect(app).toContainText('FULL-SAVED-CONTENT-END');
	await app.getByRole('button', { name: 'Load history', exact: true }).click();
	await expect(app.getByRole('button', { name: 'Load more history', exact: true })).toBeVisible();
	await app.getByRole('button', { name: 'Load more history', exact: true }).click();
	await expect(app.getByRole('button', { name: 'Load more history', exact: true })).toBeHidden();
	await capture(page, 'work-full-history', info.project.name);
	await app.getByLabel('Action', { exact: true }).selectOption('wait');
	let form = page.locator('openclaw-modal-dialog');
	await form.getByLabel('Waiting For *', { exact: true }).fill('Independent review');
	await form.getByLabel('Resume When *', { exact: true }).fill('Review is returned');
	await form.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(form).toHaveCount(0);
	await expect(app.getByText('Task · Waiting', { exact: true })).toBeVisible();
	await app.getByLabel('Action', { exact: true }).selectOption('resume');
	form = page.locator('openclaw-modal-dialog');
	await form.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(form).toHaveCount(0);
	await expect(app.getByText('Task · Ready', { exact: true })).toBeVisible();
});

test('Documents retained folder upload download and durable trash workflows survive reload', async ({
	page
}, info) => {
	await openModule(page, 'Documents');
	const app = page.locator('.falcon-native');
	await app.getByRole('button', { name: 'workspace', exact: true }).click();
	await app.getByRole('button', { name: 'New folder', exact: true }).click();
	let dialog = page.locator('openclaw-modal-dialog');
	const folder = 'retained-' + info.project.name;
	await dialog.getByLabel('Name', { exact: true }).fill(folder);
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await app.locator('.record').filter({ hasText: folder }).click();
	// Entering the folder re-renders the browser, replacing the file input. Wait for the new
	// folder's settled empty state, or setInputFiles lands on a detached input and is silently lost.
	await expect(
		app.getByRole('button', { name: 'workspace / ' + folder, exact: true })
	).toBeVisible();
	await expect(app.getByText('This folder is empty.', { exact: true })).toBeVisible();
	await app.getByLabel('Upload text file', { exact: true }).setInputFiles({
		name: 'retained.md',
		mimeType: 'text/markdown',
		buffer: Buffer.from('# Retained document\nSynthetic upload acceptance.')
	});
	await app.locator('.record').filter({ hasText: 'retained.md' }).click();
	await expect(app.getByLabel('Document content', { exact: true })).toHaveValue(
		/Synthetic upload acceptance/
	);
	await app.getByRole('button', { name: 'Copy path', exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toContain(folder + '/retained.md');
	const downloading = page.waitForEvent('download');
	await app.getByRole('button', { name: 'Download', exact: true }).click();
	expect((await downloading).suggestedFilename()).toBe('retained.md');
	await app.getByRole('button', { name: 'Move to trash', exact: true }).click();
	dialog = page.locator('openclaw-modal-dialog');
	await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await openModule(page, 'Documents');
	await app.getByRole('button', { name: 'workspace', exact: true }).click();
	await app.locator('.record').filter({ hasText: folder }).click();
	await app.getByRole('button', { name: 'Browse trash', exact: true }).click();
	await app
		.getByRole('button', { name: 'Restore ' + folder + '/retained.md', exact: true })
		.click();
	await page
		.locator('openclaw-modal-dialog')
		.getByRole('button', { name: 'Confirm', exact: true })
		.click();
	await app.locator('.record').filter({ hasText: 'retained.md' }).click();
	await expect(app.getByLabel('Document content', { exact: true })).toHaveValue(
		/Synthetic upload acceptance/
	);
	await capture(page, 'documents-retained-workflows', info.project.name);
});

test('Vault management preserves readback and exposes private recovery after removal', async ({
	page
}, info) => {
	await openModule(page, 'Vault');
	await vaultReady(page);
	const app = page.locator('.falcon-native'),
		id = 'managed-' + info.project.name,
		group = 'managed-group-' + info.project.name;
	await app.getByRole('button', { name: 'New entry', exact: true }).click();
	let dialog = page.locator('openclaw-modal-dialog');
	await dialog.getByLabel('Title', { exact: true }).fill(id);
	await dialog.getByLabel('Password', { exact: true }).fill('SYNTHETIC-MANAGED-UI');
	await dialog.getByRole('button', { name: 'Create entry', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await app.getByRole('button', { name: 'New group', exact: true }).click();
	dialog = page.locator('openclaw-modal-dialog');
	await dialog.getByLabel('Group path', { exact: true }).fill(group);
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await openVaultEntry(page, id);
	await app.getByRole('button', { name: 'Move or rename', exact: true }).click();
	dialog = page.locator('openclaw-modal-dialog');
	await dialog.getByLabel('Destination entry path', { exact: true }).fill(group + '/moved');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await selectVaultGroup(page, group);
	await openVaultEntry(page, 'moved');
	const movedPassword = vaultField(page, 'Password');
	await movedPassword.getByRole('button', { name: 'Reveal', exact: true }).click();
	await expect(movedPassword.locator('output')).toHaveText('SYNTHETIC-MANAGED-UI');
	await movedPassword.getByRole('button', { name: 'Hide', exact: true }).click();
	// Removal asks for the entry's name and keeps the control disabled until it matches exactly.
	await app.getByRole('button', { name: 'Remove', exact: true }).click();
	dialog = page.locator('openclaw-modal-dialog');
	const removeButton = dialog.getByRole('button', { name: 'Remove entry', exact: true });
	await expect(removeButton).toBeDisabled();
	await dialog.getByLabel('Type moved to confirm', { exact: true }).fill('moved');
	await expect(removeButton).toBeEnabled();
	await removeButton.click();
	await expect(page.locator('openclaw-modal-dialog')).toHaveCount(0);
	await app.getByRole('button', { name: 'Remove empty group', exact: true }).click();
	await page
		.locator('openclaw-modal-dialog')
		.getByRole('button', { name: 'Confirm', exact: true })
		.click();
	await expect(page.locator('openclaw-modal-dialog')).toHaveCount(0);
	await app.getByRole('button', { name: 'Recovery snapshots', exact: true }).click();
	await expect(app).toContainText('Private recovery snapshots');
	await expect(app).toContainText('protected host storage');
	await capture(page, 'vault-management-recovery', info.project.name);
});

test('Missing provider material produces real explanations and a native Work review without provider I/O', async ({
	page
}, info) => {
	await openModule(page, 'Vault');
	await vaultReady(page);
	await openModule(page, 'Integrations');
	const app = page.locator('.falcon-native'),
		purpose = 'Attention fixture ' + info.project.name;
	await app.getByRole('button', { name: 'Add connection', exact: true }).click();
	const dialog = page.locator('openclaw-modal-dialog');
	await dialog.getByLabel('Id', { exact: true }).fill('attention-' + info.project.name);
	await dialog.getByLabel('Provider', { exact: true }).selectOption('cloudflare');
	await dialog.getByLabel('Purpose', { exact: true }).fill(purpose);
	await dialog.getByLabel('Vault entry path', { exact: true }).fill('agent-created');
	await dialog.getByLabel('Provider account ID', { exact: true }).fill('a'.repeat(32));
	await dialog.getByLabel('Authorized agents/services (comma-separated)', { exact: true }).fill('');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	const connection = app
		.locator('.list-zone')
		.filter({ has: page.getByRole('heading', { name: purpose, exact: true }) });
	await connection.getByRole('button', { name: 'Test connection', exact: true }).click();
	await expect(app.locator('[role=alert]')).toBeVisible();
	await app.getByRole('button', { name: 'Refresh', exact: true }).click();
	await expect(connection).toContainText('Reauthorization Required');
	await connection.getByText('Account, usage and lifecycle', { exact: true }).click();
	await connection.getByRole('button', { name: 'Load connection history', exact: true }).click();
	await expect(connection).toContainText('Reauthorization Required');
	await capture(page, 'integrations-explanation-audit', info.project.name);
	await connection.getByRole('button', { name: 'Open connection review', exact: true }).click();
	await expect(page.locator('.falcon-native')).toContainText(
		'Review cloudflare connection failure'
	);
});

test('Native keyboard forms and reduced-motion 320px reflow remain usable', async ({
	page
}, info) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await openModule(page, 'Work');
	const app = page.locator('.falcon-native');
	await app.getByRole('button', { name: 'Create work', exact: true }).focus();
	await page.keyboard.press('Enter');
	const dialog = page.locator('openclaw-modal-dialog');
	await dialog.getByLabel('Type', { exact: true }).focus();
	await page.keyboard.press('Tab');
	await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await page.setViewportSize({ width: 320, height: 900 });
	for (const module of ['Work', 'Integrations', 'Vault', 'Documents']) {
		await openModule(page, module);
		await capture(page, module.toLowerCase() + '-reflow-reduced-motion', info.project.name);
		expect(
			await app
				.locator('button')
				.first()
				.evaluate((node) => getComputedStyle(node).transitionDuration)
		).toBe('0s');
	}
	expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
		true
	);
});
