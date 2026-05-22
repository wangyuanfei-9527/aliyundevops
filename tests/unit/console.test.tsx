// =============================================================================
// UI Component Tests — A10 UI
// Tests for ProjectConsole component and page rendering.
// =============================================================================

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ProjectConsole from "@/src/components/ProjectConsole";
import HomePage from "../../app/page";

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

function mockFetchResponse(data: { ok: boolean; data?: unknown; error?: string }) {
  return vi.fn().mockResolvedValue({
    ok: data.ok,
    json: () => Promise.resolve(data),
  });
}

// ---------------------------------------------------------------------------
// HomePage
// ---------------------------------------------------------------------------

describe("HomePage", () => {
  it("renders the console heading", () => {
    render(<HomePage />);
    expect(screen.getByText("阿里云测试环境控制台")).toBeInTheDocument();
  });

  it("renders the wizard step bar", () => {
    render(<HomePage />);
    expect(screen.getByText("项目信息")).toBeInTheDocument();
    expect(screen.getByText("资源推导")).toBeInTheDocument();
    expect(screen.getByText("执行")).toBeInTheDocument();
  });

  it("renders the input form by default", () => {
    render(<HomePage />);
    expect(screen.getByLabelText("代码组 (Group)")).toBeInTheDocument();
    expect(screen.getByLabelText("项目名称 (Name)")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ProjectConsole — Input form
// ---------------------------------------------------------------------------

describe("ProjectConsole — input form", () => {
  it("disables the derive button when form is incomplete", () => {
    render(<ProjectConsole />);
    const btn = screen.getByText("推导资源");
    expect(btn).toBeDisabled();
  });

  it("enables the derive button when all required fields are filled", () => {
    render(<ProjectConsole />);

    fireEvent.change(screen.getByLabelText("代码组 (Group)"), {
      target: { value: "mall" },
    });
    fireEvent.change(screen.getByLabelText("项目名称 (Name)"), {
      target: { value: "order-svc" },
    });
    fireEvent.change(screen.getByLabelText("域名"), {
      target: { value: "order.test.example.com" },
    });

    const btn = screen.getByText("推导资源");
    expect(btn).not.toBeDisabled();
  });

  it("allows switching project type", () => {
    render(<ProjectConsole />);

    const select = screen.getByLabelText("项目类型") as HTMLSelectElement;
    expect(select.value).toBe("backend");

    fireEvent.change(select, { target: { value: "frontend" } });
    expect(select.value).toBe("frontend");
  });
});

// ---------------------------------------------------------------------------
// ProjectConsole — Derive flow
// ---------------------------------------------------------------------------

describe("ProjectConsole — derive flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows derived resources after successful derive", async () => {
    const fetchMock = mockFetchResponse({
      ok: true,
      data: {
        input: { group: "mall", name: "order-svc", type: "backend", domain: "order.test.example.com" },
        derived: {
          codeGroupPath: "mall",
          repositoryPath: "order-svc",
          ossBucketName: "",
          databaseName: "test_mall_order_svc",
          dnsSubdomain: "order.test",
        },
        warnings: [],
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectConsole />);

    // Fill form
    fireEvent.change(screen.getByLabelText("代码组 (Group)"), { target: { value: "mall" } });
    fireEvent.change(screen.getByLabelText("项目名称 (Name)"), { target: { value: "order-svc" } });
    fireEvent.change(screen.getByLabelText("域名"), { target: { value: "order.test.example.com" } });

    // Click derive
    fireEvent.click(screen.getByText("推导资源"));

    await waitFor(() => {
      expect(screen.getByText("资源推导结果")).toBeInTheDocument();
    });

    // Check derived values are displayed
    expect(screen.getByText("test_mall_order_svc")).toBeInTheDocument();
    expect(screen.getByText("执行资源规划")).toBeInTheDocument();

    vi.restoreAllMocks();
  });

  it("shows error on derive failure", async () => {
    const fetchMock = mockFetchResponse({
      ok: false,
      error: "Domain not allowed",
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectConsole />);

    fireEvent.change(screen.getByLabelText("代码组 (Group)"), { target: { value: "g" } });
    fireEvent.change(screen.getByLabelText("项目名称 (Name)"), { target: { value: "n" } });
    fireEvent.change(screen.getByLabelText("域名"), { target: { value: "bad.com" } });

    fireEvent.click(screen.getByText("推导资源"));

    await waitFor(() => {
      expect(screen.getByText("Domain not allowed")).toBeInTheDocument();
    });

    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// ProjectConsole — Step bar navigation
// ---------------------------------------------------------------------------

describe("ProjectConsole — step bar", () => {
  it("highlights the current step", () => {
    render(<ProjectConsole />);

    const inputDot = screen.getByText("项目信息");
    expect(inputDot.className).toContain("active");

    const deriveDot = screen.getByText("资源推导");
    expect(deriveDot.className).not.toContain("active");
  });
});

// ---------------------------------------------------------------------------
// ProjectConsole — Empty state
// ---------------------------------------------------------------------------

describe("ProjectConsole — empty state", () => {
  it("shows form fields with placeholders", () => {
    render(<ProjectConsole />);

    expect(screen.getByPlaceholderText("例如 mall")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("例如 order-service")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("例如 order.test.example.com")).toBeInTheDocument();
  });
});
