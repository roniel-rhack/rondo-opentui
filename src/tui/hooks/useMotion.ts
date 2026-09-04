import { createContext, useContext } from "react";

export const ReducedMotionContext = createContext(false);

export function useReducedMotion(): boolean {
  return useContext(ReducedMotionContext);
}
