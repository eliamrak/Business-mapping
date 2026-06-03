import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export interface SandboxClinician {
  id: string;
  label: string;
  sessionRate: number;
  sessionsPerWeek: number;
  weeksWorkedPerYear: number;
  clinicianSplitPct: number;
  classification: "w2" | "1099";
}

export interface SandboxSettings {
  annualOverheadGoal: number;
  ownerPayGoal: number;
}

interface SandboxContextType {
  settings: SandboxSettings;
  clinicians: SandboxClinician[];
  updateSettings: (updates: Partial<SandboxSettings>) => void;
  addClinician: () => void;
  updateClinician: (id: string, updates: Partial<SandboxClinician>) => void;
  removeClinician: (id: string) => void;
}

const DEFAULT_SETTINGS: SandboxSettings = {
  annualOverheadGoal: 150000,
  ownerPayGoal: 100000,
};

const DEFAULT_CLINICIANS: SandboxClinician[] = [
  {
    id: "default-1",
    label: "Clinician 1",
    sessionRate: 150,
    sessionsPerWeek: 20,
    weeksWorkedPerYear: 48,
    clinicianSplitPct: 60,
    classification: "w2",
  },
];

const STORAGE_KEY = "@sandbox_state_v1";

const SandboxContext = createContext<SandboxContextType | null>(null);

export function SandboxProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettingsState] = useState<SandboxSettings>(DEFAULT_SETTINGS);
  const [clinicians, setCliniciansState] = useState<SandboxClinician[]>(DEFAULT_CLINICIANS);
  const loadedRef = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.settings) setSettingsState(parsed.settings);
          if (Array.isArray(parsed.clinicians) && parsed.clinicians.length > 0) {
            setCliniciansState(parsed.clinicians);
          }
        } catch {}
      }
      loadedRef.current = true;
    });
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, clinicians }));
  }, [settings, clinicians]);

  const updateSettings = useCallback((updates: Partial<SandboxSettings>) => {
    setSettingsState((prev) => ({ ...prev, ...updates }));
  }, []);

  const addClinician = useCallback(() => {
    setCliniciansState((prev) => [
      ...prev,
      {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        label: `Clinician ${prev.length + 1}`,
        sessionRate: 150,
        sessionsPerWeek: 20,
        weeksWorkedPerYear: 48,
        clinicianSplitPct: 60,
        classification: "w2" as const,
      },
    ]);
  }, []);

  const updateClinician = useCallback(
    (id: string, updates: Partial<SandboxClinician>) => {
      setCliniciansState((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
      );
    },
    []
  );

  const removeClinician = useCallback((id: string) => {
    setCliniciansState((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return (
    <SandboxContext.Provider
      value={{
        settings,
        clinicians,
        updateSettings,
        addClinician,
        updateClinician,
        removeClinician,
      }}
    >
      {children}
    </SandboxContext.Provider>
  );
}

export function useSandbox() {
  const ctx = useContext(SandboxContext);
  if (!ctx) throw new Error("useSandbox must be used within SandboxProvider");
  return ctx;
}
