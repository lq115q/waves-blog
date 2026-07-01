import { Command } from 'cmdk';
import { useEffect, useRef, useState } from 'react';

type NavItem = { label: string; href: string };

export interface CommandPaletteProps {
  locale: 'zh' | 'en';
  searchHref: string;
  pages: NavItem[];
  posts: NavItem[];
  labels: {
    placeholder: string;
    empty: string;
    groupPages: string;
    groupActions: string;
    groupPosts: string;
    actionTheme: string;
    actionSearch: string;
    actionCopyUrl: string;
  };
}

type PFResult = { url: string; meta: { title?: string } };

/** 运行时按需加载 Pagefind（构建后产物 /pagefind/pagefind.js），缺失则降级。 */
async function loadPagefind(): Promise<any | null> {
  try {
    const url = `${window.location.origin}/pagefind/pagefind.js`;
    const mod = await import(/* @vite-ignore */ url);
    await mod.options?.({ excerptLength: 15 });
    return mod;
  } catch {
    return null;
  }
}

function toggleTheme() {
  const el = document.documentElement;
  const dark = el.classList.toggle('dark');
  try {
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  } catch {
    /* ignore */
  }
}

export default function CommandPalette({
  searchHref,
  pages,
  posts,
  labels,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NavItem[]>([]);
  const pagefindRef = useRef<any | null>(null);

  // 全局快捷键 ⌘K / Ctrl+K 与外部触发事件
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('cmdk:open', onOpen as EventListener);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('cmdk:open', onOpen as EventListener);
    };
  }, []);

  // 首次打开时懒加载 Pagefind
  useEffect(() => {
    if (open && !pagefindRef.current) {
      loadPagefind().then((pf) => (pagefindRef.current = pf));
    }
  }, [open]);

  // 输入即搜（防抖）
  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      const pf = pagefindRef.current;
      if (!pf) return;
      try {
        const search = await pf.search(query);
        const top = await Promise.all(search.results.slice(0, 6).map((r: any) => r.data()));
        if (!active) return;
        setResults(
          top.map((d: PFResult) => ({ label: d.meta?.title ?? d.url, href: d.url })),
        );
      } catch {
        if (active) setResults([]);
      }
    }, 120);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const go = (href: string) => {
    setOpen(false);
    window.location.href = href;
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command Menu"
      className="cmdk-root"
    >
      <Command.Input value={query} onValueChange={setQuery} placeholder={labels.placeholder} />
      <Command.List>
        <Command.Empty>{labels.empty}</Command.Empty>

        <Command.Group heading={labels.groupActions}>
          <Command.Item onSelect={() => { setOpen(false); toggleTheme(); }}>
            {labels.actionTheme}
          </Command.Item>
          <Command.Item onSelect={() => go(searchHref)}>{labels.actionSearch}</Command.Item>
          <Command.Item
            onSelect={() => {
              navigator.clipboard?.writeText(window.location.href);
              setOpen(false);
            }}
          >
            {labels.actionCopyUrl}
          </Command.Item>
        </Command.Group>

        {results.length > 0 && (
          <Command.Group heading={labels.groupPosts}>
            {results.map((r) => (
              <Command.Item key={`r-${r.href}`} value={`result ${r.label}`} onSelect={() => go(r.href)}>
                {r.label}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading={labels.groupPages}>
          {pages.map((p) => (
            <Command.Item key={`p-${p.href}`} value={`page ${p.label}`} onSelect={() => go(p.href)}>
              {p.label}
            </Command.Item>
          ))}
        </Command.Group>

        {posts.length > 0 && (
          <Command.Group heading={labels.groupPosts}>
            {posts.map((p) => (
              <Command.Item key={`post-${p.href}`} value={`post ${p.label}`} onSelect={() => go(p.href)}>
                {p.label}
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
