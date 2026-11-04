import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { create } from "zustand";

type Product = { id: string; name: string; sellingPrice: string; categoryId?: string | null };
type Boot = {
  tenant: { name: string; slug: string };
  terminals: { _id: string; name: string; branchId: string }[];
  enabledModules: string[];
  paymentMethods: string[];
};
type CartLine = { product: Product; qty: number };

const useSession = create<{ token: string; setToken: (token: string) => void; clear: () => void }>((set) => ({
  token: sessionStorage.getItem("pos-token") ?? "",
  setToken: (token) => { sessionStorage.setItem("pos-token", token); set({ token }); },
  clear: () => { sessionStorage.removeItem("pos-token"); set({ token: "" }); },
}));

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = useSession.getState().token;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...options, headers, credentials: "include" });
  const json = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
  if (!response.ok) throw new Error(json?.error?.message ?? "Request failed");
  return json.data as T;
}

export function App() {
  const token = useSession((state) => state.token);
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={token ? <Pos /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}

function Pos() {
  return (
    <Routes>
      <Route path="/" element={<Sell />} />
      <Route path="/shift/open" element={<OpenShift />} />
      <Route path="/pay/:orderId" element={<Pay />} />
      <Route path="/receipt/:orderId" element={<Receipt />} />
      <Route path="/orders/held" element={<Held />} />
      <Route path="/orders" element={<History />} />
      <Route path="/sync" element={<SyncPage />} />
      <Route path="/printer" element={<Printer />} />
    </Routes>
  );
}

function Login() {
  const setToken = useSession((state) => state.setToken);
  const navigate = useNavigate();
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const data = await api<{ accessToken: string }>("/api/v1/pos/auth/login", { method: "POST", body: JSON.stringify({ email: form.get("email"), password: form.get("password"), tenantSlug: form.get("slug") }) });
      setToken(data.accessToken);
      navigate("/shift/open");
    } catch (err) { setError((err as Error).message); }
  }
  return (
    <form onSubmit={submit} className="mx-auto mt-20 grid max-w-sm gap-3 rounded-2xl border border-[#e6ebf2] bg-white p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#e31c3d] font-bold text-white">P</span><h1 className="text-xl font-semibold">Cashier sign in</h1></div>
      <input name="slug" defaultValue="morning-cafe" className="rounded-lg border px-3 py-3" placeholder="Business slug" />
      <input name="email" defaultValue="cashier@morning.cafe" className="rounded-lg border px-3 py-3" placeholder="Email" />
      <input name="password" type="password" required placeholder="Password" className="rounded-lg border px-3 py-3" />
      {error && <p className="text-red-700">{error}</p>}
      <button className="rounded-lg bg-[#e31c3d] text-white hover:bg-[#c41634]">Sign in</button>
    </form>
  );
}

function OpenShift() {
  const navigate = useNavigate();
  const boot = useBoot();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const terminal = boot?.terminals[0];
    if (!terminal) return;
    const shift = await api<{ _id: string }>("/api/v1/pos/shifts", { method: "POST", body: JSON.stringify({ branchId: terminal.branchId, terminalId: terminal._id, openingCash: form.get("openingCash") }) });
    sessionStorage.setItem("shift", JSON.stringify({ id: shift._id, branchId: terminal.branchId, terminalId: terminal._id }));
    navigate("/");
  }
  return (
    <form onSubmit={submit} className="mx-auto mt-20 grid max-w-sm gap-3 rounded-2xl border border-[#e6ebf2] bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold">Open shift</h1>
      <p className="text-sm text-slate-500">{boot?.tenant.name} · {boot?.terminals[0]?.name ?? "No terminal"}</p>
      <label className="text-sm text-slate-500">Opening cash<input name="openingCash" defaultValue="0.00" className="mt-1 w-full rounded-lg border px-3 py-3" /></label>
      <button className="rounded-lg bg-[#e31c3d] text-white hover:bg-[#c41634]">Start selling</button>
    </form>
  );
}

function Sell() {
  const navigate = useNavigate();
  const boot = useBoot();
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [error, setError] = useState("");
  const [orderType, setOrderType] = useState<"dine_in" | "delivery" | "takeaway">("takeaway");
  useEffect(() => {
    const handle = setTimeout(() => {
      api<{ products: Product[] }>(`/api/v1/pos/catalog?q=${encodeURIComponent(query)}`).then((data) => setProducts(data.products)).catch((err: Error) => setError(err.message));
    }, 150);
    return () => clearTimeout(handle);
  }, [query]);
  function add(product: Product) {
    setCart((current) => {
      const found = current.find((line) => line.product.id === product.id);
      if (found) return current.map((line) => line.product.id === product.id ? { ...line, qty: line.qty + 1 } : line);
      return [...current, { product, qty: 1 }];
    });
  }
  const preview = useMemo(() => cart.reduce((sum, line) => sum + Number(line.product.sellingPrice) * line.qty, 0), [cart]);
  async function pay() {
    const shift = JSON.parse(sessionStorage.getItem("shift") || "null");
    if (!shift) { navigate("/shift/open"); return; }
    try {
      const order = await api<{ id: string; total: string }>("/api/v1/pos/orders", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ branchId: shift.branchId, terminalId: shift.terminalId, shiftId: shift.id, orderType, lines: cart.map((line) => ({ productId: line.product.id, qty: String(line.qty) })) }),
      });
      navigate(`/pay/${order.id}`);
    } catch (err) {
      const offline = { id: crypto.randomUUID(), lines: cart, total: preview.toFixed(2), ref: `OFF-${Date.now()}` };
      const queue = JSON.parse(localStorage.getItem("pos-outbox") || "[]");
      queue.push(offline);
      localStorage.setItem("pos-outbox", JSON.stringify(queue));
      setError(`Saved offline as ${offline.ref}. ${(err as Error).message}`);
    }
  }
  const types = [["dine_in", "Dine in"], ["delivery", "Delivery"], ["takeaway", "Pick up"]] as const;
  return (
    <div className="flex h-screen flex-col bg-[#f4f6f9]">
      <header className="flex h-14 items-center gap-2 border-b border-[#e6ebf2] bg-white px-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#e31c3d] text-sm font-bold text-white">P</span>
        <span className="mr-2 hidden font-semibold sm:block">{boot?.tenant.name ?? "Billing"}</span>
        <NavPill to="/" label="Billing" />
        <NavPill to="/orders" label="Orders" />
        <NavPill to="/sync" label="Sync" />
        <NavPill to="/printer" label="Printer" />
        <button className="ml-auto text-sm text-slate-500" onClick={() => { useSession.getState().clear(); location.href = "/login"; }}>Sign out</button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_400px]">
        <section className="overflow-auto p-3">
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Short code" className="w-full rounded-lg border border-[#d7dee8] bg-white px-4 py-2.5" />
          {error && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-amber-800">{error}</p>}
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {products.map((product) => (
              <button key={product.id} onClick={() => add(product)} className="overflow-hidden rounded-xl border border-[#e6ebf2] bg-white text-left shadow-sm">
                <div className="grid h-20 place-items-center text-2xl font-semibold text-[#e31c3d]" style={{ background: swatch(product.name) }}>{product.name.slice(0, 1)}</div>
                <div className="p-3">
                  <div className="font-medium leading-tight">{product.name}</div>
                  <div className="mt-1 text-sm text-[#e31c3d]">₹{product.sellingPrice}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
        <aside className="flex min-h-0 flex-col border-l border-[#e6ebf2] bg-white">
          <div className="grid grid-cols-3 border-b border-[#e6ebf2] text-sm">
            {types.map(([value, label]) => (
              <button key={value} onClick={() => setOrderType(value)} className={orderType === value ? "border-b-2 border-[#e31c3d] py-3 font-medium text-[#e31c3d]" : "py-3 text-slate-500"}>{label}</button>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_96px_88px] px-3 py-2 text-xs uppercase tracking-wide text-slate-400">
            <span>Items</span><span className="text-center">Qty</span><span className="text-right">Price</span>
          </div>
          <div className="flex-1 overflow-auto">
            {cart.length === 0 && (
              <div className="grid h-full place-items-center px-6 text-center text-slate-400">
                <div><div className="text-sm font-medium text-slate-500">No item selected</div><div className="mt-1 text-xs">Select an item from the menu</div></div>
              </div>
            )}
            {cart.map((line) => (
              <div key={line.product.id} className="grid grid-cols-[1fr_96px_88px] items-center border-t border-[#f0f2f6] px-3 py-2">
                <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#e31c3d]" />{line.product.name}</span>
                <span className="flex items-center justify-center gap-2">
                  <button className="h-7 w-7 rounded border" onClick={() => setCart((rows) => rows.flatMap((row) => row.product.id === line.product.id ? (row.qty <= 1 ? [] : [{ ...row, qty: row.qty - 1 }]) : [row]))}>−</button>
                  {line.qty}
                  <button className="h-7 w-7 rounded border" onClick={() => add(line.product)}>+</button>
                </span>
                <span className="text-right">₹{(Number(line.product.sellingPrice) * line.qty).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-[#e6ebf2] p-3">
            <div className="mb-3 flex items-center justify-between rounded-lg bg-[#fff4cc] px-3 py-2 font-semibold">
              <span>Total</span><span>₹{preview.toFixed(2)}</span>
            </div>
            <div className="mb-3 grid grid-cols-4 gap-2 text-sm">
              <span className="rounded-lg border border-[#22a06b] bg-emerald-50 py-2 text-center text-emerald-700">Cash</span>
              <span className="rounded-lg border border-[#e6ebf2] py-2 text-center text-slate-400">Card</span>
              <span className="rounded-lg border border-[#e6ebf2] py-2 text-center text-slate-400">UPI</span>
              <span className="rounded-lg border border-[#e6ebf2] py-2 text-center text-slate-400">Due</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button disabled={!cart.length} onClick={pay} className="rounded-lg bg-[#22a06b] text-white disabled:bg-slate-300">Save</button>
              <button disabled={!cart.length} onClick={pay} className="rounded-lg bg-[#e31c3d] text-white disabled:bg-slate-300">Print & bill</button>
              <Link to="/orders/held" className="grid place-items-center rounded-lg border border-[#e6ebf2] text-sm">Hold</Link>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function NavPill(props: { to: string; label: string }) {
  return <Link to={props.to} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">{props.label}</Link>;
}

function swatch(name: string) {
  const colors = ["#fee2e2", "#ffedd5", "#fef9c3", "#dcfce7", "#dbeafe", "#ede9fe", "#fce7f3"];
  return colors[name.charCodeAt(0) % colors.length];
}

function Pay() {
  const { orderId = "" } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<{ total: string; lines: Array<{ name: string; qty: string }> } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<typeof order>(`/api/v1/pos/orders/${orderId}`).then(setOrder).catch((err: Error) => setError(err.message)); }, [orderId]);
  async function cash() {
    if (!order) return;
    try {
      const paid = await api<{ id: string }>(`/api/v1/pos/orders/${orderId}/payments`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ amount: order.total, method: "cash" }),
      });
      navigate(`/receipt/${paid.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <section className="mx-auto mt-10 grid max-w-md gap-3 rounded-2xl border border-[#e6ebf2] bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold">Cash payment</h1>
      {error && <p className="text-red-700">{error}</p>}
      <p className="rounded-lg bg-[#fff4cc] px-4 py-3 text-3xl font-semibold">₹{order?.total ?? "…"}</p>
      <button onClick={cash} className="rounded-lg bg-[#e31c3d] text-white hover:bg-[#c41634]">Take cash</button>
    </section>
  );
}

function Receipt() {
  const { orderId = "" } = useParams();
  const [order, setOrder] = useState<{ businessName?: string; receiptNumber?: string; total: string; lines: Array<{ name: string; qty: string; unitPrice: string }> } | null>(null);
  useEffect(() => { api<typeof order>(`/api/v1/pos/orders/${orderId}/receipt`).then(setOrder); }, [orderId]);
  return (
    <section className="mx-auto mt-8 max-w-sm rounded-2xl border border-[#e6ebf2] bg-white p-6">
      <h1 className="text-xl font-semibold">{order?.businessName}</h1>
      <p className="text-sm text-slate-500">Receipt {order?.receiptNumber ?? orderId}</p>
      {order?.lines.map((line) => <div key={line.name} className="flex justify-between border-b border-[#f0f2f6] py-2"><span>{line.name} × {line.qty}</span><span>₹{line.unitPrice}</span></div>)}
      <p className="mt-4 rounded-lg bg-[#fff4cc] px-3 py-2 text-2xl font-semibold">₹{order?.total}</p>
      <button className="mt-4 rounded-lg bg-[#e31c3d] px-4 text-white" onClick={() => window.print()}>Print</button>
      <Link className="mt-4 block text-[#e31c3d]" to="/">New sale</Link>
    </section>
  );
}

function Held() { return <section className="m-6 rounded-xl border border-[#e6ebf2] bg-white p-6">Held tickets appear here after a sale is held. <Link className="text-[#e31c3d]" to="/">Back to billing</Link></section>; }
function History() {
  const [rows, setRows] = useState<Array<{ id: string; total: string; status: string }>>([]);
  useEffect(() => { api<typeof rows>("/api/v1/pos/orders").then(setRows); }, []);
  return (
    <section className="m-6 overflow-hidden rounded-xl border border-[#e6ebf2] bg-white">
      <div className="flex items-center justify-between border-b border-[#e6ebf2] px-4 py-3"><h1 className="text-lg font-semibold">Orders</h1><Link className="text-sm text-[#e31c3d]" to="/">Billing</Link></div>
      {rows.map((row) => <Link key={row.id} to={`/receipt/${row.id}`} className="flex justify-between border-t border-[#f0f2f6] px-4 py-3 capitalize hover:bg-[#fafbfc]"><span>{row.status}</span><span>₹{row.total}</span></Link>)}
    </section>
  );
}
function SyncPage() {
  const queued = JSON.parse(localStorage.getItem("pos-outbox") || "[]") as Array<{ ref: string }>;
  return <section className="m-6 rounded-xl border border-[#e6ebf2] bg-white p-6"><h1 className="text-lg font-semibold">Sync</h1><p className="mt-2 text-slate-500">{queued.length ? queued.map((row) => row.ref).join(", ") : "Nothing waiting to sync."}</p><Link className="mt-4 inline-block text-[#e31c3d]" to="/">Back to billing</Link></section>;
}
function Printer() { return <section className="m-6 rounded-xl border border-[#e6ebf2] bg-white p-6"><h1 className="text-lg font-semibold">Printer</h1><p className="mt-2 text-slate-500">Browser printing is used until the desktop shell is installed. Receipts use the print dialog.</p></section>; }

function useBoot() {
  const [boot, setBoot] = useState<Boot | null>(null);
  useEffect(() => { api<Boot>("/api/v1/pos/bootstrap").then(setBoot).catch(() => setBoot(null)); }, []);
  return boot;
}
