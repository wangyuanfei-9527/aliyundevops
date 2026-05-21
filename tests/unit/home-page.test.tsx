import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "../../app/page";

describe("HomePage", () => {
  it("renders the foundation console heading", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { name: "阿里云测试环境自动化控制台" })).toBeInTheDocument();
    expect(screen.getByText("默认不触达真实云资源")).toBeInTheDocument();
  });
});
