export default function Page() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-160 flex-col justify-center gap-4 px-page-margin-mobile py-12 md:px-page-margin-desktop">
      <div className="rounded-lg border border-card-edge bg-card p-card-padding shadow-card">
        <h1 className="font-heading text-display text-navy">
          The Pillar Portal
        </h1>
        <p className="mt-2 text-muted-foreground">
          The portal is being built. Check back soon.
        </p>
      </div>
    </main>
  )
}
