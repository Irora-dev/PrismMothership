import { notFound } from "next/navigation";
import { SetupStudio } from "./studio";

// /setup exists only while an OPERATOR is setting up or updating the site
// (dev server). On the deployed site it is a 404 by design (the designer 2026-08-03)
// — production config lives in the host dashboard, and visitors should never
// see integrator chrome.
export default function SetupPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SetupStudio />;
}
