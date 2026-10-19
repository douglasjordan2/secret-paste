export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

const STYLE = `
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
  main { width: min(28rem, calc(100vw - 2rem)); padding: 1.5rem; border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius: 12px; }
  h1 { font-size: 1.1rem; margin: 0 0 .25rem; font-family: ui-monospace, monospace; word-break: break-all; }
  p { margin: 0 0 1rem; opacity: .8; font-size: .95rem; }
  input { width: 100%; box-sizing: border-box; font-size: 1rem; padding: .6rem .7rem; border-radius: 8px; border: 1px solid color-mix(in srgb, CanvasText 30%, transparent); background: Field; color: FieldText; }
  .row { display: flex; gap: .5rem; margin-top: 1rem; justify-content: flex-end; }
  .row .cancel { order: -1; }
  button { font-size: .95rem; padding: .55rem 1rem; border-radius: 8px; border: 1px solid color-mix(in srgb, CanvasText 30%, transparent); background: ButtonFace; color: ButtonText; cursor: pointer; }
  button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
  small { display: block; margin-top: 1rem; opacity: .6; font-size: .8rem; }
`;

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="same-origin"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

export function renderPrompt(opts: { name: string; description?: string; action: string; target: string }): string {
  const desc = opts.description ? `<p>${escapeHtml(opts.description)}</p>` : "";
  return shell(`Secret: ${opts.name}`, `
    <h1>${escapeHtml(opts.name)}</h1>${desc}
    <form method="post" action="${opts.action}">
      <input type="password" name="value" autocomplete="new-password" autocapitalize="off" spellcheck="false" autofocus required aria-label="${escapeHtml(opts.name)}">
      <div class="row">
        <button type="submit" class="primary">Submit</button>
        <button type="submit" formaction="${opts.action}/cancel" formnovalidate class="cancel">Cancel</button>
      </div>
    </form>
    <small>Stored to <code>${escapeHtml(opts.target)}</code>. The value never reaches the model or the transcript.</small>`);
}

export function renderDone(message: string): string {
  return shell("secret-paste", `<h1>${escapeHtml(message)}</h1><p>You can close this tab.</p>`);
}
