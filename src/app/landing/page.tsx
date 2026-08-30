import type { Metadata } from "next";
import { LandingContent } from "./LandingContent";
import { LANDING_COPY } from "./copy";

export const metadata: Metadata = {
  title: LANDING_COPY.en.metaTitle,
  description: LANDING_COPY.en.metaDescription,
};

export default function LandingPage() {
  return <LandingContent lang="en" />;
}
