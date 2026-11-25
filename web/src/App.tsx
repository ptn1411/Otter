import { Suspense, lazy, useEffect, useState } from "react";
import { TopNav, TopNavHeading, TopNavItem } from "@astryxdesign/core/TopNav";
import { Section } from "@astryxdesign/core/Section";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Button } from "@astryxdesign/core/Button";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Text } from "@astryxdesign/core/Text";
import { Badge } from "@astryxdesign/core/Badge";
import { useAuth } from "./auth";
import { OtterMark } from "./components/Icons";
import Home from "./pages/Home";

const Login = lazy(() => import("./pages/Login"));
const Updates = lazy(() => import("./pages/Updates"));

type Route = "home" | "login" | "updates";

function routeFromHash(): Route {
  const h = window.location.hash;
  if (h.startsWith("#/login")) return "login";
  if (h.startsWith("#/updates")) return "updates";
  return "home";
}

function go(route: Route) {
  window.location.hash = route === "home" ? "#/" : `#/${route}`;
}

export default function App({
  mode,
  onToggleMode,
}: {
  mode: "dark" | "light";
  onToggleMode: () => void;
}) {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const { user, isLoading, logout } = useAuth();

  useEffect(() => {
    const onHash = () => {
      setRoute(routeFromHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <VStack gap={0} minHeight="100vh">
      <TopNav
        label="Điều hướng chính"
        heading={
          <TopNavHeading
            logo={<OtterMark size={24} />}
            heading="Otter"
            headingHref="#/"
            headerEndContent={<Badge variant="neutral" label={`v${__OTTER_VERSION__} · MIT`} />}
          />
        }
        startContent={
          <>
            <TopNavItem label="Trang chủ" href="#/" isSelected={route === "home"} />
            <TopNavItem label="Cập nhật" href="#/updates" isSelected={route === "updates"} />
            <TopNavItem label="GitHub" href="https://github.com/ptn1411/Otter" />
          </>
        }
        endContent={
          <HStack gap={2} align="center">
            <Button
              label={mode === "dark" ? "Sáng" : "Tối"}
              variant="ghost"
              size="sm"
              onClick={onToggleMode}
            />
            {isLoading ? null : user ? (
              <HStack gap={2} align="center">
                <Avatar
                  src={user.photoURL || undefined}
                  name={user.displayName || user.email || "User"}
                  size="sm"
                />
                <Text type="supporting">{user.displayName || user.email}</Text>
                <Button label="Đăng xuất" variant="ghost" size="sm" onClick={() => logout()} />
              </HStack>
            ) : (
              <Button label="Đăng nhập" variant="primary" size="sm" onClick={() => go("login")} />
            )}
          </HStack>
        }
      />

      <main style={{ flex: 1 }}>
        <Suspense fallback={null}>
          {route === "home" && <Home />}
          {route === "login" && <Login />}
          {route === "updates" && <Updates />}
        </Suspense>
      </main>

      <Section paddingBlock={8} paddingInline={6} dividers={["top"]}>
        <div className="otter-wrap">
          <HStack gap={6} wrap="wrap" justify="between" align="center">
            <VStack gap={1.5}>
              <HStack gap={2} align="center">
                <OtterMark size={20} />
                <Text weight="semibold">Otter</Text>
                <Badge variant="neutral" label="MIT" />
              </HStack>
              <Text type="supporting">
                Phát triển bởi Phạm Thanh Nam (@ptn1411) tại Việt Nam.
              </Text>
            </VStack>
            <HStack gap={4} wrap="wrap">
              <a href="https://github.com/ptn1411/Otter" target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
              <a
                href="https://www.facebook.com/groups/1131270302617994"
                target="_blank"
                rel="noopener noreferrer"
              >
                Cộng đồng Otter
              </a>
              <a href="#/updates">Cập nhật</a>
              <a href="#/login">Tài khoản</a>
            </HStack>
          </HStack>
        </div>
      </Section>
    </VStack>
  );
}
