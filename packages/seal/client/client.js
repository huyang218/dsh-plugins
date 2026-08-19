// seal — browser half: a settings page for the signing certificate.
//
// The certificate and its passphrase are set here rather than in the profile's
// cordis.patch.yml, because that file is copied, synced and pasted into issues,
// and the generic settings form does not mask a secret. What is typed here goes
// to the host's /seal/credential route and into the storage domain.
//
// The page never receives the passphrase back. It is told only whether one is
// set — a route that returned it would put it in every browser cache and
// devtools log that ever opened this page.
//
// Written as a loader factory bundle by hand: this repository ships no build
// step, and the plugin's only client need is one form.

window.__ModuleLoader__.load({
	id: "dsh-plugin-seal",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");

		// Only `slots` is required: the page is one section, and a service that
		// is not declared here would defer apply() until it exists.
		const inject = ['slots'];

		const ENDPOINT = '/seal/credential';

		/** Read the current state; the passphrase is never part of it. */
		async function loadState() {
			const response = await fetch(ENDPOINT);
			if (!response.ok) throw new Error('读取失败(HTTP ' + response.status + ')');
			return response.json();
		}

		/** Save a certificate path and passphrase. */
		async function save(body) {
			const response = await fetch(ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			const value = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(value.error || ('保存失败(HTTP ' + response.status + ')'));
			return value;
		}

		/** Forget the stored credential. */
		async function clear() {
			const response = await fetch(ENDPOINT, { method: 'DELETE' });
			if (!response.ok) throw new Error('清除失败(HTTP ' + response.status + ')');
			return response.json();
		}

		/**
		 * Describe what is configured, in the words that matter: which file, and
		 * whether a passphrase is held — never the passphrase itself.
		 */
		function summarise(state) {
			if (!state || !state.p12Path) return '尚未配置签名证书。';
			const parts = ['证书:' + state.p12Path];
			parts.push(state.hasPassphrase ? '口令:已保存' : '口令:未设置(签名时需要在调用里给出)');
			if (!state.durable) parts.push('⚠ 没有存储后端,重启后会忘记');
			return parts.join('  ·  ');
		}

		function SealSettings() {
			const [state, setState] = React.useState(null);
			const [path, setPath] = React.useState('');
			const [passphrase, setPassphrase] = React.useState('');
			const [busy, setBusy] = React.useState(false);
			const [message, setMessage] = React.useState('');

			const refresh = React.useCallback(() => {
				loadState().then((next) => {
					setState(next);
					setPath(next.p12Path || '');
				}).catch((error) => setMessage(String(error.message || error)));
			}, []);

			React.useEffect(refresh, [refresh]);

			const onSave = () => {
				setBusy(true);
				setMessage('');
				save({ p12Path: path, passphrase })
					.then((next) => {
						setState(next);
						// Cleared from the field once it is stored: leaving a
						// passphrase in a text input is how it ends up in a
						// screenshot.
						setPassphrase('');
						setMessage('已保存。');
					})
					.catch((error) => setMessage(String(error.message || error)))
					.finally(() => setBusy(false));
			};

			const onClear = () => {
				setBusy(true);
				setMessage('');
				clear()
					.then((next) => {
						setState(next);
						setPath('');
						setPassphrase('');
						setMessage('已清除。');
					})
					.catch((error) => setMessage(String(error.message || error)))
					.finally(() => setBusy(false));
			};

			const field = (label, input, hint) => React.createElement('label', { className: 'dsh-seal-field' },
				React.createElement('span', { className: 'dsh-seal-label' }, label),
				input,
				hint ? React.createElement('span', { className: 'dsh-seal-hint' }, hint) : null,
			);

			return React.createElement('div', { className: 'dsh-seal' },
				React.createElement('p', { className: 'dsh-seal-state' }, summarise(state)),
				field('证书文件(.p12 / .pfx)',
					React.createElement('input', {
						className: 'dsh-seal-input',
						type: 'text',
						value: path,
						placeholder: '/Users/you/keys/公司.p12',
						onChange: (event) => setPath(event.target.value),
					}),
					'私钥所在的那个文件。.cer 是公钥,不能用来签名。'),
				field('口令',
					React.createElement('input', {
						className: 'dsh-seal-input',
						type: 'password',
						value: passphrase,
						placeholder: state && state.hasPassphrase ? '已保存,留空则保持不变' : '',
						onChange: (event) => setPassphrase(event.target.value),
					}),
					'存在本机的存储域里,不写进 profile 配置文件,页面也永远不会把它读回来。'),
				React.createElement('div', { className: 'dsh-seal-actions' },
					React.createElement('button', { className: 'dsh-seal-button', disabled: busy || !path, onClick: onSave }, '保存'),
					React.createElement('button', { className: 'dsh-seal-button dsh-seal-ghost', disabled: busy, onClick: onClear }, '清除'),
					message ? React.createElement('span', { className: 'dsh-seal-message' }, message) : null,
				),
				React.createElement('p', { className: 'dsh-seal-note' },
					'盖章不需要证书,只有数字签名需要。存储域不是密钥串:文件在本机未加密,'
					+ '任何以你的身份运行的程序都读得到——它的好处是口令不再跟着配置文件到处走。'),
			);
		}

		function apply(ctx) {
			const slots = ctx.slots;
			slots.inject('settings.section', () => slots.register(
				{ name: 'settings.section', id: 'seal-credential', order: 40, label: '签章证书' },
				() => React.createElement(SealSettings, null),
			), 'seal: settings section');

			ctx.effect(() => {
				const tag = document.createElement('style');
				tag.setAttribute('data-plugin-css', 'dsh-plugin-seal');
				tag.textContent = `
					.dsh-seal{display:flex;flex-direction:column;gap:14px;max-width:560px;}
					.dsh-seal-state{margin:0;padding:10px 12px;border-radius:8px;font-size:13px;
						background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.12));
						color:var(--dsw-alias-label-primary,inherit);}
					.dsh-seal-field{display:flex;flex-direction:column;gap:6px;}
					.dsh-seal-label{font-size:13px;color:var(--dsw-alias-label-primary,inherit);}
					.dsh-seal-input{padding:8px 10px;border-radius:8px;font-size:13px;
						border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.35));
						background:var(--dsw-alias-bg-overlay,transparent);color:inherit;}
					.dsh-seal-hint{font-size:12px;color:var(--dsw-alias-label-secondary,rgba(127,127,127,.9));}
					.dsh-seal-actions{display:flex;align-items:center;gap:10px;}
					.dsh-seal-button{padding:7px 16px;border-radius:8px;font-size:13px;cursor:pointer;
						border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.35));
						background:var(--dsw-alias-bg-overlay,transparent);color:inherit;}
					.dsh-seal-button[disabled]{opacity:.5;cursor:default;}
					.dsh-seal-ghost{opacity:.8;}
					.dsh-seal-message{font-size:12px;color:var(--dsw-alias-label-secondary,rgba(127,127,127,.9));}
					.dsh-seal-note{margin:0;font-size:12px;line-height:1.6;
						color:var(--dsw-alias-label-secondary,rgba(127,127,127,.9));}
				`;
				document.head.append(tag);
				return () => tag.remove();
			}, 'seal: styles');
		}

		exports.apply = apply;
		exports.inject = inject;
		// Exported for the unit tests: what the page says about a state is the
		// part that must never mention a passphrase.
		exports.summarise = summarise;
		return module.exports;
	}
});
