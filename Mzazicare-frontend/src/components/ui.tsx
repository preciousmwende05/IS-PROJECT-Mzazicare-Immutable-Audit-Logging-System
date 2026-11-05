import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Construction, Info, Search } from "lucide-react";

import { errorText } from "@/lib/api";
import { initials } from "@/lib/format";

export function PageHead(props: { crumb: string; title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">Workspace / {props.crumb}</div>
        <h1>{props.title}</h1>
        {props.sub && <p>{props.sub}</p>}
      </div>
      {props.actions && <div className="row">{props.actions}</div>}
    </div>
  );
}

export function Avatar({ name, size }: { name?: string | null; size?: "lg" | "xl" }) {
  return <div className={`avatar ${size ?? ""}`}>{initials(name)}</div>;
}

export function Badge({ tone = "", children }: { tone?: string; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Stat(props: { label: string; value: ReactNode; hint?: string; dark?: boolean }) {
  return (
    <div className={`stat ${props.dark ? "dark" : ""}`}>
      <div className="label">{props.label}</div>
      <div className="value">{props.value}</div>
      {props.hint && <div className="hint">{props.hint}</div>}
    </div>
  );
}

const BANNER_ICON = { info: Info, warn: AlertTriangle, error: AlertTriangle, success: CheckCircle2 };

export function Banner(props: { tone: "info" | "warn" | "error" | "success"; title?: string; children?: ReactNode }) {
  const Icon = BANNER_ICON[props.tone];
  return (
    <div className={`banner ${props.tone}`}>
      <Icon size={18} style={{ flex: "none", marginTop: 1 }} />
      <div>
        {props.title && <b>{props.title}</b>}
        {props.children && <span>{props.children}</span>}
      </div>
    </div>
  );
}

/** Shown on pages whose backend is not built yet. The data below it is sample data. */
export function PreviewNotice({ needs }: { needs: string }) {
  return (
    <div className="banner preview">
      <Construction size={18} style={{ flex: "none", marginTop: 1 }} />
      <div>
        <b>Preview: sample data, not connected yet</b>
        <span>This page waits on a backend piece that isn't built: {needs}. Buttons here don't save anything.</span>
      </div>
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <Banner tone="error" title="Something went wrong">{errorText(error)}</Banner>;
}

export function Field(props: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{props.label}</label>
      {props.children}
      {props.error ? <div className="err">{props.error}</div> : props.hint && <div className="hint">{props.hint}</div>}
    </div>
  );
}

export function SearchBox(props: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="search">
      <Search size={16} />
      <input value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder={props.placeholder} />
    </div>
  );
}

export function Tabs<T extends string>(props: { value: T; onChange: (v: T) => void; items: { id: T; label: string }[] }) {
  return (
    <div className="tabs">
      {props.items.map((t) => (
        <button key={t.id} className={`tab ${props.value === t.id ? "on" : ""}`} onClick={() => props.onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Load data on mount (and on `reload()`); exposes loading and error. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await run());
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [run]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}
