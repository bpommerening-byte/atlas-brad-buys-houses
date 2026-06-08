// Atlas App — Main routing and auth
// CLIENT_CONFIG is injected per-client at build time

import { useState, useEffect } from "react";
import { Route, Switch, Redirect, useLocation } from "wouter";
import AppLayout from "./components/AppLayout";
import Login from "./pages/Login";
import CountyScraper from "./pages/CountyScraper";
import PropertyCondition from "./pages/PropertyCondition";
import Settings from "./pages/Settings";
import LockedModule from "./pages/LockedModule";
import { Shield, Users, BookOpen, Flame } from "lucide-react";

// ─── CLIENT CONFIG (customized per client) ───────────────────────────────────
export const CLIENT_CONFIG = {
  companyName: "Brad Buys Houses",
  userEmail: "bpommerening@gmail.com",
  userPassword: "Brad1074$",
  accentColor: "#1D4ED8",
  counties: [
  {
    "name": "Dane",
    "state": "WI",
    "leadTypes": [
      "Sheriff Sale",
      "Bankruptcy",
      "Tax Delinquent",
      "FSBO",
      "Probate",
      "Obituary"
    ]
  },
  {
    "name": "Rock",
    "state": "WI",
    "leadTypes": [
      "Sheriff Sale",
      "Bankruptcy",
      "Probate"
    ]
  },
  {
    "name": "Door",
    "state": "WI",
    "leadTypes": [
      "Sheriff Sale",
      "Bankruptcy",
      "Probate"
    ]
  }
],
};
// ─────────────────────────────────────────────────────────────────────────────

const LOCKED_MODULES = [
  {
    path: "/insurance-gap",
    title: "Insurance Gap Finder",
    icon: Shield,
    description: "Identify properties in your market with significant insurance coverage gaps — owners who are underinsured and facing financial pressure from rising premiums or denied claims.",
    features: [
      "FEMA flood zone cross-reference",
      "ClimateCheck risk scoring",
      "Underinsured property flagging",
      "Daily automated alerts",
    ],
  },
  {
    path: "/social-distress",
    title: "Social Distress Signal",
    icon: Users,
    description: "Monitor Reddit, Facebook groups, Nextdoor, and Craigslist for motivated seller signals in your target counties — people posting about needing to sell fast.",
    features: [
      "Real-time social monitoring",
      "Keyword-based lead detection",
      "Seller sentiment scoring",
      "Direct contact extraction",
    ],
  },
  {
    path: "/obituary-monitor",
    title: "Obituary Monitor",
    icon: BookOpen,
    description: "Track local obituaries and cross-reference with property records to identify estate and probate leads before they hit the market.",
    features: [
      "Daily obituary scanning",
      "Probate record cross-reference",
      "Heir contact identification",
      "Estate property flagging",
    ],
  },
  {
    path: "/fire-damage",
    title: "Fire Damage Monitor",
    icon: Flame,
    description: "Track fire-damaged properties in your counties from incident reports and insurance filings — motivated sellers who need to move fast.",
    features: [
      "Fire incident report tracking",
      "Severity scoring",
      "Owner contact lookup",
      "Insurance claim status",
    ],
  },
];

export default function App() {
  const [isAuth, setIsAuth] = useState(() => !!localStorage.getItem("atlas_auth"));
  const [apiKeys, setApiKeys] = useState<{ googleMaps: string; openAi: string }>(() => {
    try {
      return JSON.parse(localStorage.getItem("atlas_api_keys") || "{}");
    } catch {
      return { googleMaps: "", openAi: "" };
    }
  });
  const [location] = useLocation();

  const handleLogin = () => {
    localStorage.setItem("atlas_auth", "1");
    setIsAuth(true);
  };

  const handleSaveKeys = (keys: { googleMaps: string; openAi: string }) => {
    localStorage.setItem("atlas_api_keys", JSON.stringify(keys));
    setApiKeys(keys);
  };

  if (!isAuth) {
    return (
      <Login
        companyName={CLIENT_CONFIG.companyName}
        userEmail={CLIENT_CONFIG.userEmail}
        userPassword={CLIENT_CONFIG.userPassword}
        accentColor={CLIENT_CONFIG.accentColor}
        onLogin={handleLogin}
      />
    );
  }

  return (
    <AppLayout
      companyName={CLIENT_CONFIG.companyName}
      userEmail={CLIENT_CONFIG.userEmail}
      accentColor={CLIENT_CONFIG.accentColor}
    >
      <Switch>
        <Route path="/">
          <Redirect to="/county-scraper" />
        </Route>
        <Route path="/county-scraper">
          <CountyScraper
            counties={CLIENT_CONFIG.counties}
            accentColor={CLIENT_CONFIG.accentColor}
          />
        </Route>
        <Route path="/property-condition">
          <PropertyCondition
            googleMapsConfigured={!!apiKeys.googleMaps}
            openAiConfigured={!!apiKeys.openAi}
            accentColor={CLIENT_CONFIG.accentColor}
          />
        </Route>
        <Route path="/settings">
          <Settings
            counties={CLIENT_CONFIG.counties}
            accentColor={CLIENT_CONFIG.accentColor}
            onSaveKeys={handleSaveKeys}
            savedKeys={apiKeys}
          />
        </Route>
        {LOCKED_MODULES.map((mod) => (
          <Route key={mod.path} path={mod.path}>
            <LockedModule
              title={mod.title}
              description={mod.description}
              features={mod.features}
              icon={mod.icon}
              accentColor={CLIENT_CONFIG.accentColor}
            />
          </Route>
        ))}
        <Route>
          <Redirect to="/county-scraper" />
        </Route>
      </Switch>
    </AppLayout>
  );
}
