import type { Draft } from "./plan";

/**
 * A worked example, for an empty screen.
 *
 * A tool whose first screen is a blank textarea asks the visitor to supply the
 * data before it will show them anything — which is a poor trade when they are
 * still deciding whether it is worth their addresses at all. One click puts a
 * real round on the map.
 *
 * Coordinates rather than addresses on purpose: it loads instantly, and it does
 * not spend somebody else's geocoding quota every time a curious person clicks.
 * Twelve well-known Paris landmarks, so the map is recognisable.
 */
export const DEMO_DRAFT: Draft = {
  depot: {
    label: "Depot",
    address: "Gare de Lyon, Paris",
    lat: 48.8443,
    lng: 2.3743,
  },
  stops: [
    { id: "demo-1", label: "Louvre", lat: 48.8606, lng: 2.3376, status: "located" },
    { id: "demo-2", label: "Notre-Dame", lat: 48.853, lng: 2.3499, status: "located" },
    { id: "demo-3", label: "Eiffel Tower", lat: 48.8584, lng: 2.2945, status: "located" },
    { id: "demo-4", label: "Arc de Triomphe", lat: 48.8738, lng: 2.295, status: "located" },
    { id: "demo-5", label: "Sacré-Cœur", lat: 48.8867, lng: 2.3431, status: "located" },
    { id: "demo-6", label: "Panthéon", lat: 48.8462, lng: 2.3464, status: "located" },
    { id: "demo-7", label: "Musée d'Orsay", lat: 48.86, lng: 2.3266, status: "located" },
    { id: "demo-8", label: "Bastille", lat: 48.8532, lng: 2.3692, status: "located" },
    { id: "demo-9", label: "Père Lachaise", lat: 48.8614, lng: 2.3922, status: "located" },
    { id: "demo-10", label: "Parc Montsouris", lat: 48.822, lng: 2.338, status: "located" },
    { id: "demo-11", label: "Gare du Nord", lat: 48.8809, lng: 2.3553, status: "located" },
    { id: "demo-12", label: "Château de Vincennes", lat: 48.8353, lng: 2.4353, status: "located" },
  ],
};
