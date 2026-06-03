import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useRef, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSandbox, SandboxClinician } from "@/context/SandboxContext";
import { useColors } from "@/hooks/useColors";
import { calculateSandboxResults, formatCurrency } from "@/lib/calculations";

function NumericField({
  label,
  value,
  onChange,
  prefix,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  prefix?: string;
  suffix?: string;
}) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(String(value));

  const handleFocus = useCallback(() => {
    setFocused(true);
    setText(String(value));
  }, [value]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    const n = parseFloat(text.replace(/[^0-9.]/g, ""));
    if (!isNaN(n) && n >= 0) {
      onChange(n);
      setText(String(n));
    } else {
      setText(String(value));
    }
  }, [text, value, onChange]);

  const handleChange = useCallback((t: string) => {
    setText(t);
    const n = parseFloat(t.replace(/[^0-9.]/g, ""));
    if (!isNaN(n) && n >= 0) onChange(n);
  }, [onChange]);

  return (
    <View style={styles.fieldWrapper}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View
        style={[
          styles.fieldInput,
          {
            borderColor: focused ? colors.secondary : colors.border,
            backgroundColor: colors.muted,
          },
        ]}
      >
        {prefix ? (
          <Text style={[styles.affix, { color: colors.mutedForeground }]}>{prefix}</Text>
        ) : null}
        <TextInput
          style={[styles.fieldText, { color: colors.foreground }]}
          value={focused ? text : String(value)}
          onChangeText={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          keyboardType="decimal-pad"
          selectTextOnFocus
        />
        {suffix ? (
          <Text style={[styles.affix, { color: colors.mutedForeground }]}>{suffix}</Text>
        ) : null}
      </View>
    </View>
  );
}

function ClinicianCard({
  clinician,
  practiceNet,
  annualProduction,
}: {
  clinician: SandboxClinician;
  practiceNet: number;
  annualProduction: number;
}) {
  const colors = useColors();
  const { updateClinician, removeClinician } = useSandbox();
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelText, setLabelText] = useState(clinician.label);

  const handleRemove = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert("Remove Clinician", `Remove "${clinician.label}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => removeClinician(clinician.id),
      },
    ]);
  }, [clinician.id, clinician.label, removeClinician]);

  const practiceSplitPct = 100 - clinician.clinicianSplitPct;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        {editingLabel ? (
          <TextInput
            style={[styles.cardLabelInput, { color: colors.foreground, borderColor: colors.secondary }]}
            value={labelText}
            onChangeText={setLabelText}
            onBlur={() => {
              setEditingLabel(false);
              if (labelText.trim()) updateClinician(clinician.id, { label: labelText.trim() });
              else setLabelText(clinician.label);
            }}
            autoFocus
            selectTextOnFocus
          />
        ) : (
          <Pressable onPress={() => setEditingLabel(true)} style={styles.cardLabelBtn}>
            <Text style={[styles.cardLabel, { color: colors.foreground }]}>{clinician.label}</Text>
            <Feather name="edit-2" size={12} color={colors.mutedForeground} style={{ marginLeft: 4 }} />
          </Pressable>
        )}
        <Pressable onPress={handleRemove} hitSlop={8} testID={`remove-${clinician.id}`}>
          <Feather name="trash-2" size={16} color={colors.destructive} />
        </Pressable>
      </View>

      <View style={styles.cardRow}>
        <NumericField
          label="Session Rate"
          value={clinician.sessionRate}
          onChange={(n) => updateClinician(clinician.id, { sessionRate: n })}
          prefix="$"
        />
        <NumericField
          label="Practice Split"
          value={practiceSplitPct}
          onChange={(n) => updateClinician(clinician.id, { clinicianSplitPct: Math.max(0, Math.min(100, 100 - n)) })}
          suffix="%"
        />
      </View>

      <View style={styles.cardRow}>
        <NumericField
          label="Sessions/Week"
          value={clinician.sessionsPerWeek}
          onChange={(n) => updateClinician(clinician.id, { sessionsPerWeek: n })}
        />
        <NumericField
          label="Weeks/Year"
          value={clinician.weeksWorkedPerYear}
          onChange={(n) => updateClinician(clinician.id, { weeksWorkedPerYear: n })}
        />
      </View>

      <View style={[styles.cardFooter, { borderTopColor: colors.border }]}>
        <View style={styles.cardStat}>
          <Text style={[styles.cardStatLabel, { color: colors.mutedForeground }]}>Gross production</Text>
          <Text style={[styles.cardStatValue, { color: colors.foreground }]}>
            {formatCurrency(annualProduction)}
          </Text>
        </View>
        <View style={[styles.cardStatDivider, { backgroundColor: colors.border }]} />
        <View style={styles.cardStat}>
          <Text style={[styles.cardStatLabel, { color: colors.mutedForeground }]}>Net to practice</Text>
          <Text style={[styles.cardStatValue, { color: colors.secondary }]}>
            {formatCurrency(practiceNet)}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function SandboxScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings, clinicians, updateSettings, addClinician } = useSandbox();

  const results = calculateSandboxResults(clinicians, settings);
  const isSurplus = results.gap >= 0;

  const handleAddClinician = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addClinician();
  }, [addClinician]);

  const webTopPad = Platform.OS === "web" ? 67 : 0;
  const bottomPad = Platform.OS === "web" ? 84 + 20 : 100;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: webTopPad + 16, paddingBottom: bottomPad },
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View
        style={[
          styles.gapBanner,
          {
            backgroundColor: isSurplus ? colors.accent : "#fff1f2",
            borderColor: isSurplus ? colors.secondary : colors.destructive,
          },
        ]}
      >
        <Text
          style={[styles.gapAmount, { color: isSurplus ? colors.secondary : colors.destructive }]}
        >
          {isSurplus ? "+" : ""}
          {formatCurrency(results.gap)}
        </Text>
        <Text style={[styles.gapLabel, { color: isSurplus ? colors.accentForeground : "#991b1b" }]}>
          {isSurplus ? "surplus above goal" : "shortfall below goal"}
        </Text>
      </View>

      <View style={[styles.metricsRow]}>
        <View style={[styles.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.metricValue, { color: colors.foreground }]}>
            {formatCurrency(results.totalPracticeNet, true)}
          </Text>
          <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>Net to practice</Text>
        </View>
        <View style={[styles.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.metricValue, { color: colors.foreground }]}>
            {formatCurrency(results.totalNeed, true)}
          </Text>
          <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>Goal needed</Text>
        </View>
        <View style={[styles.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.metricValue, { color: colors.foreground }]}>
            {formatCurrency(results.totalClinicianComp, true)}
          </Text>
          <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>Clinician comp</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.primary }]}>Practice Goals</Text>
        <View style={[styles.goalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <NumericField
            label="Annual Overhead"
            value={settings.annualOverheadGoal}
            onChange={(n) => updateSettings({ annualOverheadGoal: n })}
            prefix="$"
          />
          <View style={[styles.goalDivider, { backgroundColor: colors.border }]} />
          <NumericField
            label="Owner Pay Goal"
            value={settings.ownerPayGoal}
            onChange={(n) => updateSettings({ ownerPayGoal: n })}
            prefix="$"
          />
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.primary }]}>
            Clinicians ({clinicians.length})
          </Text>
        </View>

        {clinicians.map((c, i) => (
          <ClinicianCard
            key={c.id}
            clinician={c}
            practiceNet={results.clinicianResults[i]?.practiceNet ?? 0}
            annualProduction={results.clinicianResults[i]?.annualProduction ?? 0}
          />
        ))}

        <Pressable
          style={({ pressed }) => [
            styles.addBtn,
            {
              backgroundColor: pressed ? colors.secondary : colors.primary,
              borderColor: colors.primary,
            },
          ]}
          onPress={handleAddClinician}
          testID="add-clinician"
        >
          <Feather name="plus" size={18} color={colors.primaryForeground} />
          <Text style={[styles.addBtnText, { color: colors.primaryForeground }]}>
            Add Clinician
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 0 },

  gapBanner: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 20,
    paddingHorizontal: 20,
    alignItems: "center",
    marginBottom: 12,
  },
  gapAmount: { fontSize: 36, fontFamily: "Inter_700Bold", letterSpacing: -1 },
  gapLabel: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },

  metricsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 24,
  },
  metricCard: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  metricValue: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  metricLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2, textAlign: "center" },

  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 },

  goalCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  goalDivider: { height: 1 },

  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  cardLabelBtn: { flexDirection: "row", alignItems: "center", flex: 1 },
  cardLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardLabelInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    borderBottomWidth: 1,
    paddingVertical: 0,
    marginRight: 8,
  },

  cardRow: { flexDirection: "row", gap: 12, marginBottom: 10 },

  cardFooter: {
    flexDirection: "row",
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  cardStat: { flex: 1 },
  cardStatDivider: { width: 1, marginHorizontal: 12 },
  cardStatLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  cardStatValue: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 2 },

  fieldWrapper: { flex: 1 },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 4 },
  fieldInput: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  fieldText: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    padding: 0,
    minWidth: 40,
  },
  affix: { fontSize: 13, fontFamily: "Inter_400Regular" },

  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    paddingVertical: 14,
    gap: 8,
    marginTop: 4,
  },
  addBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
