import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
const processor = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(remarkRehype)
	.use(rehypeSanitize)
	.use(rehypeStringify);
export function documentPreview(markdown) {
	const content = String(processor.processSync(markdown));
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:16px/1.7 sans-serif;color:#e5e1e4;background:#131315;padding:16px;overflow-wrap:anywhere}pre{white-space:pre-wrap}table{border-collapse:collapse}td,th{border:1px solid #555;padding:8px}a{color:#f7bf59}</style></head><body>${content}</body></html>`;
}
