import ClientApp from "./ClientApp";

export default function Page() {
  const convexUrl =
    process.env.NEXT_PUBLIC_CONVEX_URL ||
    process.env.VITE_CONVEX_URL ||
    process.env.CONVEX_URL ||
    "";

  return <ClientApp convexUrl={convexUrl} />;
}
