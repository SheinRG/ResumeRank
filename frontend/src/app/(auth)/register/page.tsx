import type { Metadata } from "next";

import { RegisterForm } from "@/components/auth/register-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FadeIn } from "@/components/motion";

export const metadata: Metadata = {
  title: "Create account",
};

function RegisterPage() {
  return (
    <FadeIn>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Create your account</CardTitle>
          <CardDescription>
            Start screening candidates with explainable AI scoring.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RegisterForm />
        </CardContent>
      </Card>
    </FadeIn>
  );
}

export default RegisterPage;
