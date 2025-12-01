"""
Metrics collection and storage utilities
"""
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional
import statistics


class MetricsCollector:
    """
    Collects and stores test metrics
    """

    def __init__(self, output_dir: Optional[Path] = None):
        self.metrics: Dict[str, list] = {}
        self.output_dir = output_dir or Path(__file__).parent.parent / "results"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.run_id = datetime.now().strftime("%Y%m%d_%H%M%S")

    def record(self, metric_name: str, value: float, metadata: Optional[Dict] = None):
        """
        Record a metric value

        Args:
            metric_name: Name of the metric
            value: Metric value
            metadata: Optional metadata dictionary
        """
        if metric_name not in self.metrics:
            self.metrics[metric_name] = []

        self.metrics[metric_name].append({
            "value": value,
            "timestamp": time.time(),
            "metadata": metadata or {}
        })

    def get_stats(self, metric_name: str) -> Dict[str, float]:
        """
        Get statistics for a metric

        Args:
            metric_name: Name of the metric

        Returns:
            Dictionary with mean, median, std, min, max, p50, p95, p99
        """
        if metric_name not in self.metrics or len(self.metrics[metric_name]) == 0:
            return {}

        values = [m["value"] for m in self.metrics[metric_name]]

        return {
            "count": len(values),
            "mean": statistics.mean(values),
            "median": statistics.median(values),
            "stdev": statistics.stdev(values) if len(values) > 1 else 0,
            "min": min(values),
            "max": max(values),
            "p50": statistics.quantiles(values, n=2)[0] if len(values) > 1 else values[0],
            "p95": statistics.quantiles(values, n=20)[18] if len(values) >= 20 else max(values),
            "p99": statistics.quantiles(values, n=100)[98] if len(values) >= 100 else max(values),
        }

    def get_summary(self) -> Dict[str, Any]:
        """
        Get summary of all metrics

        Returns:
            Dictionary with all metric statistics
        """
        summary = {
            "run_id": self.run_id,
            "timestamp": datetime.now().isoformat(),
            "metrics": {}
        }

        for metric_name in self.metrics:
            summary["metrics"][metric_name] = self.get_stats(metric_name)

        return summary

    def save_to_file(self, filename: Optional[str] = None):
        """
        Save metrics to JSON file

        Args:
            filename: Output filename (default: metrics_{run_id}.json)
        """
        if filename is None:
            filename = f"metrics_{self.run_id}.json"

        output_path = self.output_dir / filename

        # Save detailed metrics
        detailed_path = self.output_dir / f"detailed_{filename}"
        with open(detailed_path, 'w') as f:
            json.dump(self.metrics, f, indent=2)

        # Save summary
        summary = self.get_summary()
        with open(output_path, 'w') as f:
            json.dump(summary, f, indent=2)

        print(f"Metrics saved to {output_path}")
        print(f"Detailed metrics saved to {detailed_path}")

    def compare_with_baseline(self, baseline_path: Path) -> Dict[str, Any]:
        """
        Compare current metrics with baseline

        Args:
            baseline_path: Path to baseline metrics JSON

        Returns:
            Dictionary with comparison results
        """
        with open(baseline_path, 'r') as f:
            baseline = json.load(f)

        current = self.get_summary()
        comparison = {
            "baseline_run_id": baseline.get("run_id", "unknown"),
            "current_run_id": self.run_id,
            "regressions": [],
            "improvements": []
        }

        for metric_name in current["metrics"]:
            if metric_name not in baseline.get("metrics", {}):
                continue

            baseline_value = baseline["metrics"][metric_name].get("mean", 0)
            current_value = current["metrics"][metric_name].get("mean", 0)

            if baseline_value == 0:
                continue

            change_pct = ((current_value - baseline_value) / baseline_value) * 100

            # Determine if regression based on metric type
            is_regression = False
            if metric_name.startswith("wer") or metric_name.endswith("latency_ms"):
                # Lower is better
                is_regression = change_pct > 20  # 20% increase is regression
            elif metric_name.startswith("pesq") or metric_name.endswith("accuracy"):
                # Higher is better
                is_regression = change_pct < -5  # 5% decrease is regression

            if is_regression:
                comparison["regressions"].append({
                    "metric": metric_name,
                    "baseline": baseline_value,
                    "current": current_value,
                    "change_pct": change_pct
                })
            elif abs(change_pct) > 5:  # Significant improvement
                if (metric_name.startswith("wer") or metric_name.endswith("latency_ms")):
                    if change_pct < 0:  # Decreased (good)
                        comparison["improvements"].append({
                            "metric": metric_name,
                            "baseline": baseline_value,
                            "current": current_value,
                            "change_pct": change_pct
                        })
                else:  # PESQ, accuracy
                    if change_pct > 0:  # Increased (good)
                        comparison["improvements"].append({
                            "metric": metric_name,
                            "baseline": baseline_value,
                            "current": current_value,
                            "change_pct": change_pct
                        })

        return comparison

    def print_summary(self):
        """Print metrics summary to console"""
        summary = self.get_summary()

        print("\n" + "=" * 80)
        print(f"METRICS SUMMARY - Run ID: {self.run_id}")
        print("=" * 80)

        for metric_name, stats in summary["metrics"].items():
            print(f"\n{metric_name}:")
            print(f"  Count:  {stats['count']}")
            print(f"  Mean:   {stats['mean']:.3f}")
            print(f"  Median: {stats['median']:.3f}")
            print(f"  Std:    {stats['stdev']:.3f}")
            print(f"  Min:    {stats['min']:.3f}")
            print(f"  Max:    {stats['max']:.3f}")
            print(f"  p50:    {stats['p50']:.3f}")
            print(f"  p95:    {stats['p95']:.3f}")
            print(f"  p99:    {stats['p99']:.3f}")

        print("\n" + "=" * 80)


def send_alert(title: str, details: Any, webhook_url: Optional[str] = None):
    """
    Send alert notification (currently prints to console)

    Args:
        title: Alert title
        details: Alert details
        webhook_url: Optional Slack webhook URL
    """
    print(f"\n⚠️  ALERT: {title}")
    print(json.dumps(details, indent=2))

    # TODO: Implement actual Slack webhook when configured
    if webhook_url:
        import requests
        try:
            payload = {
                "text": f"⚠️ {title}",
                "blocks": [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*{title}*\n```{json.dumps(details, indent=2)}```"
                        }
                    }
                ]
            }
            requests.post(webhook_url, json=payload, timeout=5)
        except Exception as e:
            print(f"Failed to send alert: {e}")
