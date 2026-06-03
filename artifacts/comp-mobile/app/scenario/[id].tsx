import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useGetScenario } from "@workspace/api-client-react";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { calculateClinicianMetrics, formatCurrency } from "@/lib/calculations";

function roleLabel(role: string): string {
  const map: Record<string, string> = {
    senior_clinician: "Senior",
    associate: "Associate",
    owner: "Owner",
    contractor: "Contractor",
    other: "Other",
  };
  return map[role] ?? role;
}

function classLabel(cls: string): string {
  if (cls === "w2") return "W-2";
  if (cls === "1099") return "1099";
  if (cls === "owner") return "Owner";
  return cls;
}

export default function ScenarioDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();

  const { data: scenario, isLoading, isError, refetch } = useGetScenario({
    path: { id: Number(id) },
  });

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.secondary} />
      </View>
    );
  }

  if (isError || !scenario) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="alert-circle" size={32} color={colors.destructive} />
        <Text style={[styles.errorText, { color: colors.foreground }]}>
          Could not load scenario
        </Text>
        <Pressable
          style={[styles.retryBtn, { backgroundColor: colors.primary }]}
          onPress={() => refetch()}
        >
          <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  const clinicians = scenario.clinicians ?? [];

  let totalPracticeNet = 0;
  let totalClinicianComp = 0;
  let totalProduction = 0;

  const clinicianMetrics = clinicians.map((c) => {
    const metrics = calculateClinicianMetrics({
      sessionRate: c.sessionRate,
      sessionsPerWeek: c.sessionsPerWeek,
      weeksWorkedPerYear: c.weeksWorkedPerYear,
      capEnabled: c.capEnabled,
      capAmount: c.capAmount,
      preCapClinicianSplit: c.preCapClinicianSplit,
      preCapPracticeSplit: c.preCapPracticeSplit,
      postCapClinicianSplit: c.postCapClinicianSplit,
      postCapPracticeSplit: c.postCapPracticeSplit,
      classification: c.classification,
      w2EmployerFicaPct: c.w2EmployerFicaPct,
      futaSutaPct: c.futaSutaPct,
      workersCompPct: c.workersCompPct,
      otherEmployerBurdenPct: c.otherEmployerBurdenPct,
    });
    totalPracticeNet += metrics.practiceNetBeforeOverhead;
    totalClinicianComp += metrics.clinicianCompensation;
    totalProduction += metrics.annualProduction;
    return { clinician: c, metrics };
  });

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: webTopPad + 16, paddingBottom: 60 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {scenario.notes ? (
        <View style={[styles.notesBanner, { backgroundColor: colors.accent, borderColor: colors.secondary }]}>
          <Text style={[styles.notesText, { color: colors.accentForeground }]}>{scenario.notes}</Text>
        </View>
      ) : null}

      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { backgroundColor: colors.primary }]}>
          <Text style={[styles.summaryValue, { color: colors.primaryForeground }]}>
            {formatCurrency(totalProduction, true)}
          </Text>
          <Text style={[styles.summaryLabel, { color: colors.primaryForeground, opacity: 0.75 }]}>
            Gross production
          </Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: colors.secondary }]}>
          <Text style={[styles.summaryValue, { color: colors.secondaryForeground }]}>
            {formatCurrency(totalPracticeNet, true)}
          </Text>
          <Text style={[styles.summaryLabel, { color: colors.secondaryForeground, opacity: 0.85 }]}>
            Net to practice
          </Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}>
          <Text style={[styles.summaryValue, { color: colors.foreground }]}>
            {formatCurrency(totalClinicianComp, true)}
          </Text>
          <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>
            Clinician comp
          </Text>
        </View>
      </View>

      {clinicians.length === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="users" size={28} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No clinicians in this scenario</Text>
        </View>
      ) : (
        <>
          <Text style={[styles.sectionTitle, { color: colors.primary }]}>
            Clinicians ({clinicians.length})
          </Text>
          {clinicianMetrics.map(({ clinician, metrics }) => (
            <View
              key={clinician.id}
              style={[styles.clinicianCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.clinicianHeader}>
                <View>
                  <Text style={[styles.clinicianName, { color: colors.foreground }]}>
                    {clinician.label}
                  </Text>
                  <View style={styles.badges}>
                    <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                      <Text style={[styles.badgeText, { color: colors.accentForeground }]}>
                        {roleLabel(clinician.roleType)}
                      </Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: colors.muted }]}>
                      <Text style={[styles.badgeText, { color: colors.mutedForeground }]}>
                        {classLabel(clinician.classification)}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={styles.clinicianSplit}>
                  <Text style={[styles.splitValue, { color: colors.secondary }]}>
                    {clinician.preCapPracticeSplit}%
                  </Text>
                  <Text style={[styles.splitLabel, { color: colors.mutedForeground }]}>to practice</Text>
                </View>
              </View>

              <View style={[styles.clinicianDivider, { backgroundColor: colors.border }]} />

              <View style={styles.statsGrid}>
                <View style={styles.stat}>
                  <Text style={[styles.statVal, { color: colors.foreground }]}>
                    ${clinician.sessionRate}
                  </Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Rate</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={[styles.statVal, { color: colors.foreground }]}>
                    {clinician.sessionsPerWeek}/wk
                  </Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Sessions</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={[styles.statVal, { color: colors.foreground }]}>
                    {clinician.weeksWorkedPerYear} wks
                  </Text>
                  <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>Per year</Text>
                </View>
              </View>

              <View style={[styles.clinicianFooter, { borderTopColor: colors.border }]}>
                <View style={styles.footerStat}>
                  <Text style={[styles.footerStatLbl, { color: colors.mutedForeground }]}>Production</Text>
                  <Text style={[styles.footerStatVal, { color: colors.foreground }]}>
                    {formatCurrency(metrics.annualProduction)}
                  </Text>
                </View>
                <View style={styles.footerStat}>
                  <Text style={[styles.footerStatLbl, { color: colors.mutedForeground }]}>Clinician pays</Text>
                  <Text style={[styles.footerStatVal, { color: colors.foreground }]}>
                    {formatCurrency(metrics.clinicianCompensation)}
                  </Text>
                </View>
                <View style={styles.footerStat}>
                  <Text style={[styles.footerStatLbl, { color: colors.mutedForeground }]}>Practice net</Text>
                  <Text style={[styles.footerStatVal, { color: colors.secondary }]}>
                    {formatCurrency(metrics.practiceNetBeforeOverhead)}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  errorText: { fontSize: 16, fontFamily: "Inter_500Medium", textAlign: "center" },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, marginTop: 4 },
  retryText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  content: { paddingHorizontal: 16, gap: 0 },

  notesBanner: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  notesText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },

  summaryRow: { flexDirection: "row", gap: 8, marginBottom: 24 },
  summaryCard: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  summaryValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2, textAlign: "center" },

  sectionTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 10,
  },

  clinicianCard: { borderRadius: 12, borderWidth: 1, marginBottom: 10 },
  clinicianHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: 14,
    paddingBottom: 10,
  },
  clinicianName: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  badges: { flexDirection: "row", gap: 6 },
  badge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  clinicianSplit: { alignItems: "flex-end" },
  splitValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  splitLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },

  clinicianDivider: { height: 1, marginHorizontal: 14 },

  statsGrid: {
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 0,
  },
  stat: { flex: 1 },
  statVal: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  statLbl: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },

  clinicianFooter: {
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    gap: 0,
  },
  footerStat: { flex: 1 },
  footerStatLbl: { fontSize: 11, fontFamily: "Inter_400Regular" },
  footerStatVal: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 2 },

  emptyState: { alignItems: "center", paddingTop: 40, gap: 8 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
