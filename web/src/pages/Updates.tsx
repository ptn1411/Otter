import { useCallback, useEffect, useMemo, useState } from "react";
import { Section } from "@astryxdesign/core/Section";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Badge } from "@astryxdesign/core/Badge";
import { Divider } from "@astryxdesign/core/Divider";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Markdown } from "@astryxdesign/core/Markdown";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Spinner } from "@astryxdesign/core/Spinner";
import { fetchVersions, componentLabel, trackDownload, type VersionRecord } from "../api";
import { DownloadIcon } from "../components/Icons";

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function Updates() {
  const [versions, setVersions] = useState<VersionRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  const load = useCallback(() => {
    setFailed(false);
    setVersions(null);
    fetchVersions()
      .then(setVersions)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const components = useMemo(() => {
    if (!versions) return [];
    return Array.from(new Set(versions.map((v) => v.component)));
  }, [versions]);

  const visible = useMemo(() => {
    if (!versions) return [];
    if (filter === "all") return versions;
    return versions.filter((v) => v.component === filter);
  }, [versions, filter]);

  return (
    <Section paddingBlock={10} paddingInline={6}>
      <div className="otter-wrap-narrow">
        <VStack gap={6}>
          <VStack gap={2}>
            <Heading level={1}>Thông báo & cập nhật</Heading>
            <Text type="supporting">
              Nhật ký các phiên bản phát hành mới nhất của Otter, đồng bộ trực tiếp từ máy chủ phát
              hành chính thức.
            </Text>
          </VStack>

          {versions && versions.length > 1 && components.length > 1 && (
            <SegmentedControl label="Lọc theo thành phần" value={filter} onChange={setFilter}>
              <SegmentedControlItem value="all" label={`Tất cả (${versions.length})`} />
              {components.map((c) => (
                <SegmentedControlItem key={c} value={c} label={componentLabel(c)} />
              ))}
            </SegmentedControl>
          )}

          {versions === null && !failed && (
            <Card padding={6}>
              <HStack gap={3} align="center">
                <Spinner />
                <Text>Đang tải danh sách phiên bản từ máy chủ phát hành…</Text>
              </HStack>
            </Card>
          )}

          {failed && (
            <EmptyState
              title="Chưa tải được danh sách cập nhật"
              description="Máy chủ phát hành đang bận hoặc kết nối mạng bị gián đoạn. Thử lại sau ít phút."
              actions={<Button label="Thử lại" variant="primary" onClick={load} />}
            />
          )}

          {versions !== null && visible.length === 0 && (
            <EmptyState
              title="Chưa có thông báo nào"
              description="Khi có phiên bản mới, thông tin chi tiết sẽ xuất hiện tại đây."
            />
          )}

          {visible.map((v, i) => (
            <Card key={`${v.component}-${v.version}-${i}`} padding={5}>
              <VStack gap={4}>
                <HStack justify="between" align="center" wrap="wrap" gap={3}>
                  <HStack gap={2} align="center" wrap="wrap">
                    <Heading level={2}>
                      {componentLabel(v.component)}{" "}
                      <span className="otter-mono">{v.version}</span>
                    </Heading>
                    {i === 0 && filter === "all" && <Badge variant="success" label="Mới nhất" />}
                  </HStack>
                  {v.release_date && (
                    <Text type="supporting">
                      <span className="otter-mono">{formatDate(v.release_date)}</span>
                    </Text>
                  )}
                </HStack>

                <Divider />

                {v.changelog ? (
                  <Markdown headingLevelStart={3}>{v.changelog}</Markdown>
                ) : (
                  <Text type="supporting">Phiên bản này không kèm ghi chú thay đổi.</Text>
                )}

                {v.download_url && (
                  <HStack>
                    <Button
                      label={`Tải bản ${v.version}`}
                      variant="secondary"
                      size="sm"
                      icon={<DownloadIcon size={14} />}
                      onClick={() => {
                        trackDownload({
                          component: v.component,
                          platform: v.component === "extension" ? "chrome" : "unknown",
                          version: v.version,
                          source: "web-updates",
                        });
                        window.open(v.download_url!, "_blank", "noopener");
                      }}
                    />
                  </HStack>
                )}
              </VStack>
            </Card>
          ))}
        </VStack>
      </div>
    </Section>
  );
}
