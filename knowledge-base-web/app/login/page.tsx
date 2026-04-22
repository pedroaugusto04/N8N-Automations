import { redirectIfAuthenticated, loginAction } from '../actions';

export const dynamic = 'force-dynamic';

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  await redirectIfAuthenticated();
  const params = (await searchParams) ?? {};
  const error = Array.isArray(params.error) ? params.error[0] : params.error;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="paper-panel w-full max-w-md rounded-[28px] p-8 sm:p-10">
        <div className="mb-8">
          <p className="mb-3 text-xs uppercase tracking-[0.36em] text-pine">KB remoto</p>
          <h1 className="font-serif text-4xl leading-tight text-ink">Entrar em /notes</h1>
          <p className="mt-3 text-sm leading-6 text-stone-600">
            A sessao protege a interface web e mantem o segredo do webhook somente no servidor.
          </p>
        </div>

        <form action={loginAction} className="space-y-5">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Senha</span>
            <div className="field-shell rounded-2xl px-4 py-3">
              <input
                autoFocus
                required
                type="password"
                name="password"
                className="field-input"
                placeholder="Digite a senha da interface"
              />
            </div>
          </label>

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              Senha invalida. Tente novamente.
            </div>
          ) : null}

          <button
            type="submit"
            className="w-full rounded-2xl bg-ink px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-stone-800"
          >
            Abrir cliente do KB
          </button>
        </form>

        <div className="mt-8 rounded-2xl bg-accent-soft px-4 py-4 text-sm leading-6 text-stone-700">
          Use esta tela para registrar notas remotas sem expor <code>KB_WEBHOOK_SECRET</code> no navegador.
        </div>
      </section>
    </main>
  );
}
