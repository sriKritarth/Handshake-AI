import React, { useState } from "react";
import { Modal } from "@/components/common/Modal";
import { useLoginMutation, useSignupMutation } from "@/features/api/apiSlice";
import { useAppDispatch } from "@/hooks/useRedux";
import { setCredentials } from "@/features/auth/authSlice";
import { toClientFriendlyMessage } from "@/utils/clientError";
import { Button } from "@/components/common/Button";
import { Lock, Mail, User } from "lucide-react";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const dispatch = useAppDispatch();
  const [isSignUp, setIsSignUp] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<"buyer" | "merchant">("buyer");

  const [loginUser, { isLoading: isLoginLoading }] = useLoginMutation();
  const [signupUser, { isLoading: isSignupLoading }] = useSignupMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    try {
      if (isSignUp) {
        if (password !== confirmPassword) {
          setErrorMsg("Passwords do not match");
          return;
        }
        const res = await signupUser({
          first_name: firstName,
          last_name: lastName,
          email_id: email,
          password,
          confirm_password: confirmPassword,
          role,
        }).unwrap();

        dispatch(setCredentials({ token: res.token, user: res.user }));
        onClose();
      } else {
        const res = await loginUser({
          email_id: email,
          password,
        }).unwrap();

        dispatch(setCredentials({ token: res.token, user: res.user }));
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(toClientFriendlyMessage(err, "Authentication failed. Check your inputs."));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isSignUp ? "Create Wholesale Account" : "Sign In to Handshake AI"}
      description={
        isSignUp
          ? "Register as a wholesale buyer or merchant for autonomous price settlements."
          : "Access live sessions, negotiated discounts, and order histories."
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        {errorMsg && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
            {errorMsg}
          </div>
        )}

        {isSignUp && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-neutral-400 mb-1">
                First Name
              </label>
              <div className="relative flex items-center">
                <User className="absolute left-3 h-4 w-4 text-neutral-500" />
                <input
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="John"
                  className="w-full rounded-xl border border-white/10 bg-neutral-900 py-2.5 pl-9 pr-3 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-primary-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-400 mb-1">
                Last Name
              </label>
              <input
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Doe"
                className="w-full rounded-xl border border-white/10 bg-neutral-900 py-2.5 px-3 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-primary-500"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-neutral-400 mb-1">
            Email Address
          </label>
          <div className="relative flex items-center">
            <Mail className="absolute left-3 h-4 w-4 text-neutral-500" />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="buyer@enterprise.com"
              className="w-full rounded-xl border border-white/10 bg-neutral-900 py-2.5 pl-9 pr-3 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-primary-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-neutral-400 mb-1">
            Password
          </label>
          <div className="relative flex items-center">
            <Lock className="absolute left-3 h-4 w-4 text-neutral-500" />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full rounded-xl border border-white/10 bg-neutral-900 py-2.5 pl-9 pr-3 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-primary-500"
            />
          </div>
        </div>

        {isSignUp && (
          <>
            <div>
              <label className="block text-xs font-semibold text-neutral-400 mb-1">
                Confirm Password
              </label>
              <div className="relative flex items-center">
                <Lock className="absolute left-3 h-4 w-4 text-neutral-500" />
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded-xl border border-white/10 bg-neutral-900 py-2.5 pl-9 pr-3 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-primary-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-400 mb-1">
                Account Role
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRole("buyer")}
                  className={`rounded-xl border p-2 text-xs font-semibold transition-all ${
                    role === "buyer"
                      ? "border-primary-500 bg-primary-500/10 text-primary-400"
                      : "border-white/10 bg-neutral-900 text-neutral-400"
                  }`}
                >
                  Wholesale Buyer
                </button>
                <button
                  type="button"
                  onClick={() => setRole("merchant")}
                  className={`rounded-xl border p-2 text-xs font-semibold transition-all ${
                    role === "merchant"
                      ? "border-primary-500 bg-primary-500/10 text-primary-400"
                      : "border-white/10 bg-neutral-900 text-neutral-400"
                  }`}
                >
                  Merchant / Seller
                </button>
              </div>
            </div>
          </>
        )}

        <Button
          type="submit"
          isLoading={isLoginLoading || isSignupLoading}
          className="mt-2 w-full py-3"
        >
          {isSignUp ? "Complete Registration" : "Sign In"}
        </Button>

        <div className="text-center text-xs text-neutral-400 mt-2">
          {isSignUp ? "Already have an account?" : "Need a wholesale account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp);
              setErrorMsg(null);
            }}
            className="text-primary-400 font-semibold underline hover:text-primary-300"
          >
            {isSignUp ? "Sign In" : "Register now"}
          </button>
        </div>
      </form>
    </Modal>
  );
};
