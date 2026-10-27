export default function GateLayout({ children }: LayoutProps<"/foro">) {
  return (
    <main className="mx-auto flex w-full max-w-[520px] flex-1 flex-col justify-center gap-8 px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex flex-col gap-8 duration-200 ease-out animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
        {children}
      </div>
    </main>
  );
}
