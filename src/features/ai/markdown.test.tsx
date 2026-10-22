import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Markdown, parseBlocks, safeHref } from './markdown';

/** The assistant's answers as React elements: the Markdown it writes, and never HTML. */

afterEach(cleanup);

const show = (text: string) => render(<Markdown text={text} />).container;

describe('the Markdown of answers', () => {
  it('shows paragraphs, bold, italics, inline code and line breaks', () => {
    const view = show('Open **Payroll** then *Leave*.\nPress `New leave`.\n\nThat is all.');
    const paragraphs = view.querySelectorAll('p');
    expect(paragraphs).toHaveLength(2);
    expect(view.querySelector('strong')?.textContent).toBe('Payroll');
    expect(view.querySelector('em')?.textContent).toBe('Leave');
    expect(view.querySelector('code')?.textContent).toBe('New leave');
    expect(paragraphs[0].querySelector('br')).not.toBeNull();
    expect(paragraphs[1].textContent).toBe('That is all.');
  });

  it('shows numbered and bulleted lists, nested once, with the numbers asked for', () => {
    const view = show(
      '1. Open **Maham People**.\n2. Go to Leave.\n   - Annual\n   - Sick\n\n3. Save.\n\n- One\n* Two',
    );
    const ordered = view.querySelector('ol')!;
    expect(ordered.querySelectorAll(':scope > li')).toHaveLength(3);
    expect(ordered.querySelector('li ul')?.querySelectorAll('li')).toHaveLength(2);
    expect(view.querySelectorAll(':scope > div > ul > li')).toHaveLength(2);
    expect(show('3. Third\n4. Fourth').querySelector('ol')?.getAttribute('start')).toBe('3');
  });

  it('shows code blocks as written, even before the fence is closed', () => {
    const view = show('Example:\n```\nKD 1,250.500\n  **not bold**\n```\nDone.');
    expect(view.querySelector('pre')?.textContent).toBe('KD 1,250.500\n  **not bold**');
    expect(view.querySelector('pre strong')).toBeNull();
    expect(show('```\nstill being written').querySelector('pre')?.textContent).toBe(
      'still being written',
    );
  });

  it('shows headings, quotes, rules and simple tables', () => {
    const view = show(
      '## Steps\n> Check with your auditor.\n\n---\n\n| Item | Days |\n|---|---|\n| Annual | 30 |',
    );
    expect(view.querySelector('p.font-semibold')?.textContent).toBe('Steps');
    expect(view.querySelector('blockquote')?.textContent).toBe('Check with your auditor.');
    expect(view.querySelector('hr')).not.toBeNull();
    expect([...view.querySelectorAll('th')].map((c) => c.textContent)).toEqual(['Item', 'Days']);
    expect([...view.querySelectorAll('td')].map((c) => c.textContent)).toEqual(['Annual', '30']);
  });

  it('leaves names with underscores and lone stars as they are', () => {
    const view = show('Use leave_reason_id and 2 * 3 * 4.');
    expect(view.querySelector('em')).toBeNull();
    expect(view.textContent).toBe('Use leave_reason_id and 2 * 3 * 4.');
  });

  it('lets each block find its own direction, for Arabic and English together', () => {
    const view = show('افتح **الرواتب** ثم الإجازات.\n\n- Payroll\n- الإجازات');
    expect(view.querySelector('p')?.getAttribute('dir')).toBe('auto');
    for (const item of view.querySelectorAll('li')) expect(item.getAttribute('dir')).toBe('auto');
    // The list too, so an English list's bullets sit inside it in an Arabic page.
    expect(view.querySelector('ul')?.getAttribute('dir')).toBe('auto');
    expect(view.querySelector('strong')?.textContent).toBe('الرواتب');
  });
});

describe('what an answer can never do', () => {
  it('put HTML on the page', () => {
    const attack =
      '<img src=x onerror="alert(1)"><script>alert(2)</script> **<b>bold</b>** `<i>x</i>`\n\n<iframe src="https://example.com"></iframe>';
    const view = show(attack);
    for (const tag of ['img', 'script', 'iframe', 'b', 'i']) {
      expect(view.querySelector(tag)).toBeNull();
    }
    expect(view.querySelector('[onerror]')).toBeNull();
    expect(view.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(view.textContent).toContain('<script>alert(2)</script>');
    expect(view.querySelector('strong')?.textContent).toBe('<b>bold</b>');
  });

  it('link anywhere but an https address, and an https link opens apart from the app', () => {
    const view = show(
      '[Safe](https://www.pifss.gov.kw/) [Script](javascript:alert(1)) [Plain](http://example.com) [Data](data:text/html,hi) [Tel](tel:+96512345678)',
    );
    const links = view.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://www.pifss.gov.kw/');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(view.textContent).toContain('Script');
    expect(view.textContent).not.toContain('javascript:');
    expect(safeHref('JAVASCRIPT:alert(1)')).toBeNull();
    expect(safeHref('https://example.com/a b')).toBe('https://example.com/a%20b');
  });

  it('be rendered as raw HTML anywhere in the assistant’s code', () => {
    const dir = __dirname;
    const sources = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
    expect(sources.length).toBeGreaterThan(5);
    for (const file of sources) {
      const code = readFileSync(join(dir, file), 'utf8');
      expect(code, file).not.toMatch(
        /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML/,
      );
    }
  });

  it('hang on endless or odd input', () => {
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks('\n\n\n')).toEqual([]);
    const long = `${'**'.repeat(2000)}${'_'.repeat(2000)}${'`'.repeat(2000)}`;
    expect(() => show(long)).not.toThrow();
  });
});
