import {
  createContext,
  useContext,
  useState,
  useId,
  cloneElement,
  type ReactElement,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export function Button({
  className,
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  return (
    <button
      type="button"
      className={cn(
        "btn",
        variant === "primary" && "btn-primary",
        variant === "danger" && "btn-danger",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();

  return (
    <div className="grid gap-2 text-sm font-medium text-slate-700">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children as ReactElement<{ id?: string; "aria-describedby"?: string }>, {
        id,
        "aria-describedby": hint ? `${id}-hint` : undefined,
      })}
      {hint && (
        <span id={`${id}-hint`} className="font-normal text-xs text-slate-500">
          {hint}
        </span>
      )}
    </div>
  );
}

export function Notice({ error, success }: { error?: string; success?: string }) {
  return (
    <>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800"
        >
          {success}
        </p>
      )}
    </>
  );
}

export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
      <p>{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const ConfirmContext = createContext<(text: string) => Promise<boolean>>(async () => false);

export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{
    text: string;
    resolve: (value: boolean) => void;
  } | null>(null);
  const settle = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider
      value={(text) => new Promise((resolve) => setPending({ text, resolve }))}
    >
      {children}
      <AlertDialog.Root open={!!pending}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-40 bg-slate-950/30" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <AlertDialog.Title className="text-lg font-semibold">确认操作</AlertDialog.Title>
            <AlertDialog.Description className="my-4 text-sm leading-7 text-slate-600">
              {pending?.text}
            </AlertDialog.Description>
            <div className="flex justify-end gap-3">
              <AlertDialog.Cancel asChild>
                <Button onClick={() => settle(false)}>取消</Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button variant="primary" onClick={() => settle(true)}>
                  确认
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </ConfirmContext.Provider>
  );
}
