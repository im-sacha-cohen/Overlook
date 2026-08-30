import Script from "next/script";

// Default project — the shared Overlook OSS usage dashboard. Self-hosters
// can point this at their own Clarity project via NEXT_PUBLIC_CLARITY_PROJECT_ID,
// or opt out entirely with NEXT_PUBLIC_DISABLE_TELEMETRY=1.
const DEFAULT_CLARITY_PROJECT_ID = "yahgty78gs";

export function Telemetry() {
  if (process.env.NEXT_PUBLIC_DISABLE_TELEMETRY === "1") return null;
  const projectId = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID || DEFAULT_CLARITY_PROJECT_ID;

  return (
    <Script id="ms-clarity" strategy="afterInteractive">
      {`(function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
      })(window, document, "clarity", "script", "${projectId}");`}
    </Script>
  );
}
