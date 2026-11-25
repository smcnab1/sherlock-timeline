"use client";

import { create } from "zustand";
import type { EventItem, Relationship, WorkspaceCase } from "@/lib/types";

type Scale = "hour" | "day" | "week" | "month" | "year";

type SherlockState = {
  activeCase: WorkspaceCase | null;
  selectedEventId: string | null;
  query: string;
  scale: Scale;
  relationFilter: string;
  setCase: (activeCase: WorkspaceCase) => void;
  setSelectedEventId: (selectedEventId: string | null) => void;
  setQuery: (query: string) => void;
  setScale: (scale: Scale) => void;
  setRelationFilter: (relationFilter: string) => void;
  addEvent: (event: EventItem) => void;
  deleteEvent: (eventId: string) => void;
  addRelationship: (relationship: Relationship) => void;
};

export const useSherlockStore = create<SherlockState>((set) => ({
  activeCase: null,
  selectedEventId: null,
  query: "",
  scale: "day",
  relationFilter: "all",
  setCase: (activeCase) => set({ activeCase }),
  setSelectedEventId: (selectedEventId) => set({ selectedEventId }),
  setQuery: (query) => set({ query }),
  setScale: (scale) => set({ scale }),
  setRelationFilter: (relationFilter) => set({ relationFilter }),
  addEvent: (event) =>
    set((state) => ({
      activeCase: state.activeCase
        ? {
            ...state.activeCase,
            events: [...state.activeCase.events, event].sort(
              (a, b) =>
                new Date(a.startDate).getTime() -
                new Date(b.startDate).getTime(),
            ),
          }
        : state.activeCase,
      selectedEventId: event.id,
    })),
  deleteEvent: (eventId) =>
    set((state) => {
      if (!state.activeCase) {
        return state;
      }

      const events = state.activeCase.events.filter((event) => event.id !== eventId);
      const nextSelectedEventId =
        state.selectedEventId === eventId ? (events[0]?.id ?? null) : state.selectedEventId;

      return {
        activeCase: {
          ...state.activeCase,
          events,
        },
        selectedEventId: nextSelectedEventId,
      };
    }),
  addRelationship: (relationship) =>
    set((state) => ({
      activeCase: state.activeCase,
      selectedEventId: relationship.targetId,
    })),
}));
