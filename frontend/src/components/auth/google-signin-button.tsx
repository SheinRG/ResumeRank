import { Button } from "@/components/ui/button";
import { signInWithGoogleAction } from "@/server/actions/auth";

type GoogleSignInButtonProps = {
  next?: string;
};

function GoogleSignInButton({ next }: GoogleSignInButtonProps) {
  return (
    <form action={signInWithGoogleAction.bind(null, next)}>
      <Button type="submit" variant="outline" className="w-full">
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.42 3.58v2.98h3.92c2.29-2.11 3.52-5.21 3.52-8.8Z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.24 0 5.95-1.08 7.93-2.92l-3.92-2.98c-1.09.73-2.48 1.16-4.01 1.16-3.08 0-5.7-2.08-6.64-4.88H1.31v3.07C3.28 21.3 7.31 24 12 24Z"
          />
          <path
            fill="#FBBC05"
            d="M5.36 14.38A7.19 7.19 0 0 1 5 12c0-.83.14-1.63.36-2.38V6.55H1.31A11.98 11.98 0 0 0 0 12c0 1.93.46 3.76 1.31 5.45l4.05-3.07Z"
          />
          <path
            fill="#EA4335"
            d="M12 4.77c1.76 0 3.34.6 4.59 1.79l3.44-3.44C17.94 1.19 15.24 0 12 0 7.31 0 3.28 2.7 1.31 6.55l4.05 3.07C6.3 6.85 8.92 4.77 12 4.77Z"
          />
        </svg>
        Continue with Google
      </Button>
    </form>
  );
}

export { GoogleSignInButton };
