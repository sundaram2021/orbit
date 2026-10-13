import { Suspense } from "react";
import { HeroSection } from "@/components/home/hero-section";
import { WorkflowSection } from "@/components/home/workflow-section";
import { BentoSection } from "@/components/home/bento-section";
import { StepsSection } from "@/components/home/steps-section";
import { FooterStage } from "@/components/home/footer-stage";
import { fetchServerOrbitUser } from "@/lib/supabase-server-helpers";

export const metadata = {
  title: "Orbit — Your autonomous software factory",
  description:
    "From GitHub issue to pull request. Orbit orchestrates specialized agents that build, review, and learn together.",
};

async function HeroAuth() {
  const user = await fetchServerOrbitUser();
  return <HeroSection isAuthenticated={user !== null} />;
}

async function FooterAuth() {
  const user = await fetchServerOrbitUser();
  return <FooterStage isAuthenticated={user !== null} />;
}

export default function HomePage() {
  return (
    <main className="stages-container">
      <Suspense fallback={<div className="hero-loading">Loading…</div>}>
        <HeroAuth />
      </Suspense>
      <WorkflowSection />
      <BentoSection />
      <StepsSection />
      <Suspense fallback={null}>
        <FooterAuth />
      </Suspense>
    </main>
  );
}
