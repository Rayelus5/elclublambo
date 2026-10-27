import { PageLoader } from "@/components/shell/page-loader";

// Route-level fallback inside <main> (the forum layout and its sidebar stay visible). Pages with their own Suspense
// fallback show that one instead; this covers the segments that have none.
export default function ForumLoading() {
  return <PageLoader />;
}
