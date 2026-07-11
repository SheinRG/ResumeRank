import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FadeIn } from "@/components/motion";

export const metadata: Metadata = {
  title: "Forgot password",
};

function ForgotPasswordPage() {
  return (
    <FadeIn>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Reset your password</CardTitle>
          <CardDescription>
            Enter the email on your account and we&apos;ll send a link to
            reset your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForgotPasswordForm />
        </CardContent>
      </Card>
    </FadeIn>
  );
}

export default ForgotPasswordPage;
