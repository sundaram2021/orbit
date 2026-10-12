import React from "react";
import Image from "next/image";
import Link from "next/link";
import { OrbitMark } from "@/components/common/orbit-mark";

export function LoginArtPanel() {
  return (
    <section className="login-art">
      <Image
        className="mist-image"
        src="/orbit-mist.jpg"
        alt="A cable car traveling through alpine mist"
        fill
        priority
      />
      <div className="photo-wash" />

      <Link className="brand" href="/">
        <OrbitMark />
        <span>orbit</span>
      </Link>

      <blockquote>
        One team.
        <br />
        Every repository.
        <br />
        Infinite possibilities.
        <p>Your code. Your context. Your Orbit.</p>
      </blockquote>

      <span className="mono">A LITTLE LESS MANAGING. A LOT MORE SHIPPING.</span>
    </section>
  );
}
