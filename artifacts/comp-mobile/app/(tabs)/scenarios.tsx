import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useListScenarios } from "@workspace/api-client-react";
import React, { useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

function ScenarioRow({
  id,
  name,
  notes,
  createdAt,
}: {
  id: number;
  name: string;
  notes: string | null;
  createdAt: string;
}) {
  const colors = useColors();
  const router = useRouter();

  const handlePress = useCallback(() => {
    router.push(`/scenario/${id}`);
  }, [id, router]);

  const dateStr = new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.muted : colors.card,
          borderColor: colors.border,
        },
      ]}
      testID={`scenario-${id}`}
    >
      <View style={styles.rowContent}>
        <View style={[styles.rowIcon, { backgroundColor: colors.accent }]}>
          <Feather name="folder" size={18} color={colors.secondary} />
        </View>
        <View style={styles.rowText}>
          <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>
            {name}
          </Text>
          {notes ? (
            <Text style={[styles.rowNotes, { color: colors.mutedForeground }]} numberOfLines={1}>
              {notes}
            </Text>
          ) : (
            <Text style={[styles.rowDate, { color: colors.mutedForeground }]}>{dateStr}</Text>
          )}
        </View>
      </View>
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

export default function ScenariosScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data: scenarios, isLoading, isError, refetch, isFetching } = useListScenarios();

  const webTopPad = Platform.OS === "web" ? 67 : 0;
  const bottomPad = Platform.OS === "web" ? 84 + 20 : 100;

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.secondary} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Feather name="alert-circle" size={32} color={colors.destructive} />
        <Text style={[styles.errorText, { color: colors.foreground }]}>
          Could not load scenarios
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

  const list = scenarios ?? [];

  return (
    <FlatList
      data={list}
      keyExtractor={(item) => String(item.id)}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.listContent,
        { paddingTop: webTopPad + 16, paddingBottom: bottomPad },
      ]}
      scrollEnabled={!!list.length}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isFetching && !isLoading}
          onRefresh={refetch}
          tintColor={colors.secondary}
        />
      }
      renderItem={({ item }) => (
        <ScenarioRow
          id={item.id}
          name={item.name}
          notes={item.notes ?? null}
          createdAt={item.createdAt}
        />
      )}
      ItemSeparatorComponent={() => (
        <View style={[styles.separator, { backgroundColor: colors.border }]} />
      )}
      ListEmptyComponent={() => (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.muted }]}>
            <Feather name="folder" size={32} color={colors.mutedForeground} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No saved scenarios</Text>
          <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>
            Save a scenario from the desktop dashboard to view it here
          </Text>
        </View>
      )}
      ListHeaderComponent={
        list.length > 0 ? (
          <Text style={[styles.listHeader, { color: colors.mutedForeground }]}>
            {list.length} saved scenario{list.length !== 1 ? "s" : ""}
          </Text>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  errorText: { fontSize: 16, fontFamily: "Inter_500Medium", textAlign: "center" },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, marginTop: 4 },
  retryText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  listContent: { paddingHorizontal: 16 },
  listHeader: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 8 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  rowContent: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowNotes: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  rowDate: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  separator: { height: 8 },

  empty: { alignItems: "center", paddingTop: 80, gap: 12, paddingHorizontal: 32 },
  emptyIcon: { width: 72, height: 72, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  emptyDesc: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
});
