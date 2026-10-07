import type { Metadata } from "next";
import { LoginForm } from "@/src/components/login-form";

export const metadata: Metadata = {
  title: "Come on in · ghumi.ghumi",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return <LoginForm />;
}
