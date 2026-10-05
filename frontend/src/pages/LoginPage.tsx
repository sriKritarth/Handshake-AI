import React, { useState } from "react";
import { useLoginMutation, useSignupMutation } from "@/features/api/apiSlice";
import { useAppDispatch } from "@/hooks/useRedux";
import { setCredentials } from "@/features/auth/authSlice";
import { toClientFriendlyMessage } from "@/utils/clientError";
import { Button } from "@/components/common/Button";
import {
  Handshake,
  Lock,
  Mail,
  User,
  ShieldCheck,
  Bot,
  TrendingDown,
  ArrowRight,
  Sparkles,
} from "lucide-react";

export const LoginPage: React.FC = () => {
  const dispatch = useAppDispatch();
  const [isSignUp, setIsSignUp] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form state
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
      } else {
        const res = await loginUser({
          email_id: email,
          password,
        }).unwrap();

        dispatch(setCredentials({ token: res.token, user: res.user }));
      }
    } catch (err: any) {
      setErrorMsg(
        toClientFriendlyMessage(err, "Authentication failed. Please verify your credentials.")
      );
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-neutral-850 shadow-2xl lg:grid-cols-12">
        {/* Left Editorial Branding Banner */}
        <div className="relative flex flex-col justify-between border-b border-white/10 bg-gradient-to-br from-neutral-900 via-neutral-850 to-neutral-950 p-8 sm:p-12 lg:col-span-6 lg:border-b-0 lg:border-r">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary-500/30 bg-primary-500/10 px-3 py-1 text-xs font-semibold text-primary-400 mb-6">
              <Sparkles className="h-3.5 w-3.5 fill-current" />
              <span>Autonomous B2B Commerce</span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
              Enterprise Wholesale, <br />
              <span className="bg-gradient-to-r from-primary-400 via-emerald-300 to-teal-400 bg-clip-text text-transparent">
                Negotiated in Real Time.
              </span>
            </h1>

            <p className="mt-4 text-xs sm:text-sm text-neutral-300 leading-relaxed max-w-md">
              Sign in to unlock exclusive wholesale catalog inventory, request custom bulk
              discounts, and complete verified orders in seconds.
            </p>
          </div>

          {/* Pillars List */}
          <div className="mt-8 flex flex-col gap-3.5 border-t border-white/10 pt-6">
            <div className="flex items-center gap-3 text-xs text-neutral-300">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-500/10 border border-primary-500/20 text-primary-400">
                <Bot className="h-4 w-4" />
              </div>
              <span>Automated instant price optimization for wholesale bulk quantities</span>
            </div>

            <div className="flex items-center gap-3 text-xs text-neutral-300">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-500/10 border border-primary-500/20 text-primary-400">
                <TrendingDown className="h-4 w-4" />
              </div>
              <span>Tiered volume pricing with dedicated seller discount approvals</span>
            </div>

            <div className="flex items-center gap-3 text-xs text-neutral-300">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-500/10 border border-primary-500/20 text-primary-400">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <span>Verified digital agreement & secure Razorpay payment settlement</span>
            </div>
          </div>

          <div className="mt-8 font-mono text-[11px] text-neutral-500">
            Handshake AI Platform • Enterprise Wholesale Commerce
          </div>

          {/* Decorative Glow */}
          <div className="absolute top-0 left-0 -ml-16 -mt-16 h-72 w-72 rounded-full bg-primary-500/10 blur-3xl pointer-events-none" />
        </div>

        {/* Right Authentication Form */}
        <div className="flex flex-col justify-center p-8 sm:p-12 lg:col-span-6 bg-neutral-850/80 backdrop-blur-xl">
          <div className="mb-6">
            <div className="flex rounded-xl bg-neutral-900 p-1 border border-white/5 mb-6">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(false);
                  setErrorMsg(null);
                }}
                className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-all ${
                  !isSignUp
                    ? "bg-primary-500 text-neutral-950 font-bold shadow-glow"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(true);
                  setErrorMsg(null);
                }}
                className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-all ${
                  isSignUp
                    ? "bg-primary-500 text-neutral-950 font-bold shadow-glow"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                Create Account
              </button>
            </div>

            <h2 className="text-xl font-bold text-white tracking-tight">
              {isSignUp ? "Register Wholesale Profile" : "Welcome Back"}
            </h2>
            <p className="text-xs text-neutral-400 mt-1">
              {isSignUp
                ? "Enter your company details to access wholesale trading."
                : "Enter your registered credentials to access the catalog."}
            </p>
          </div>

          {errorMsg && (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-400 animate-fadeIn">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            {isSignUp && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1">
                    First Name
                  </label>
                  <div className="relative flex items-center">
                    <User className="absolute left-3 h-4 w-4 text-neutral-500" />
                    <input
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="Jane"
                      className="w-full rounded-xl border border-white/10 bg-neutral-900 py-2.5 pl-9 pr-3 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-primary-500 transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1">
                    Last Name
                  </label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Smith"
                    className="w-full rounded-xl border border-white/10 bg-neutral-900 py-2.5 px-3 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-primary-500 transition-colors"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">
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
                  className="w-full rounded-xl border border-white/10 bg-neutral-900 py-2.5 pl-9 pr-3 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-primary-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">
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
                  className="w-full rounded-xl border border-white/10 bg-neutral-900 py-2.5 pl-9 pr-3 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-primary-500 transition-colors"
                />
              </div>
            </div>

            {isSignUp && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1">
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
                      className="w-full rounded-xl border border-white/10 bg-neutral-900 py-2.5 pl-9 pr-3 text-xs text-neutral-100 placeholder-neutral-600 outline-none focus:border-primary-500 transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1">
                    Select Your Role
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRole("buyer")}
                      className={`rounded-xl border p-2.5 text-xs font-semibold transition-all ${
                        role === "buyer"
                          ? "border-primary-500 bg-primary-500/10 text-primary-400"
                          : "border-white/10 bg-neutral-900 text-neutral-400 hover:text-white"
                      }`}
                    >
                      Wholesale Buyer
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole("merchant")}
                      className={`rounded-xl border p-2.5 text-xs font-semibold transition-all ${
                        role === "merchant"
                          ? "border-primary-500 bg-primary-500/10 text-primary-400"
                          : "border-white/10 bg-neutral-900 text-neutral-400 hover:text-white"
                      }`}
                    >
                      Merchant / Supplier
                    </button>
                  </div>
                </div>
              </>
            )}

            <Button
              type="submit"
              isLoading={isLoginLoading || isSignupLoading}
              className="mt-3 w-full py-3 gap-2"
            >
              <span>{isSignUp ? "Create Wholesale Account" : "Sign In to Catalog"}</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>

          <div className="mt-6 text-center text-xs text-neutral-400">
            {isSignUp ? "Already registered?" : "New wholesale trader?"}{" "}
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setErrorMsg(null);
              }}
              className="font-semibold text-primary-400 hover:underline"
            >
              {isSignUp ? "Sign In" : "Create an account"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
