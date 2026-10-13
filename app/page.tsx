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

function HeroSkeleton() {
  return (
    <section aria-busy="true" aria-label="Loading" className="hero">
      <div className="animate-pulse rounded-md bg-muted/40 h-[320px] w-full" aria-hidden="true" />
    </section>
  );
}

function FooterSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-2 p-6">
      <div className="animate-pulse rounded-md bg-muted/40 h-6 w-1/4 mx-auto" aria-hidden="true" />
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="stages-container">
      <Suspense fallback={<HeroSkeleton />}>
        <HeroAuth />
      </Suspense>
      <WorkflowSection />
      <BentoSection />
      <StepsSection />
      <Suspense fallback={<FooterSkeleton />}>
        <FooterAuth />
      </Suspense>
    </main>
  );
}
