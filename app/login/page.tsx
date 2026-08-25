import { Suspense } from "react";
import LoginForm from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-center font-serif italic text-2xl tracking-tight">
          graphic studio by shoaib
          <span className="text-accent not-italic font-sans font-bold">.</span>
        </h1>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
