export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}
