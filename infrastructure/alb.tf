# ============================================================================
# Application Load Balancer — HTTP-only, in public subnets
# CloudFront terminates TLS from the user; CloudFront → ALB is HTTP over the
# AWS backbone.
#
# Security: Two layers of protection against direct ALB access:
#   1. Security group restricts to AWS CloudFront managed prefix list
#   2. ALB listener rules validate X-CloudFront-Secret header
# ============================================================================

# ============================================================================
# ALB Security Group — restrict to CloudFront prefix list only
# ============================================================================

# AWS-managed prefix list for CloudFront edge locations.
# This restricts network-layer access so only CloudFront IPs can reach the ALB.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${var.project_name}-alb-${var.environment}"
  description = "Allow inbound HTTP (port 80) from CloudFront"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "HTTP from CloudFront"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-alb-sg"
  }
}

# ============================================================================
# Application Load Balancer
# ============================================================================

# checkov:skip=CKV_AWS_91: ALB access logs not required for this sample; CloudFront logs cover request auditing.
# checkov:skip=CKV_AWS_150: Deletion protection disabled for easy teardown of sample infrastructure.
# checkov:skip=CKV2_AWS_28: WAF not attached to ALB; CloudFront WAF is the perimeter defense layer (see CKV2_AWS_47 in cloudfront.tf).
resource "aws_lb" "backend" {
  name               = "${var.project_name}-alb-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  # SSE streaming needs long idle timeout — 120s (default is 60)
  idle_timeout = 120

  # Drop invalid HTTP headers for security hardening
  drop_invalid_header_fields = true

  tags = {
    Name = "${var.project_name}-alb"
  }
}

# ============================================================================
# Target Group — port 3001, health check on /api/health
# ============================================================================

resource "aws_lb_target_group" "backend" {
  name        = "${var.project_name}-tg-${var.environment}"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/api/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 10
    matcher             = "200"
  }

  # Shorter drain for faster rollouts. SSE clients reconnect automatically.
  deregistration_delay = 30

  tags = {
    Name = "${var.project_name}-tg"
  }
}

# ============================================================================
# HTTP Listener — validates X-CloudFront-Secret header at ALB level
#
# Rule 1: If X-CloudFront-Secret matches → forward to target group
# Default: Return 403 "Access denied" (blocks direct ALB access)
# ============================================================================

# checkov:skip=CKV_AWS_2: HTTP listener is intentional — CloudFront terminates TLS, ALB is HTTP-only behind CloudFront.
# checkov:skip=CKV_AWS_103: HTTPS redirect not needed — CloudFront enforces HTTPS at the edge.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.backend.arn
  port              = 80
  protocol          = "HTTP"

  # Default action: reject requests that don't come through CloudFront
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Access denied"
      status_code  = "403"
    }
  }

  tags = {
    Name = "${var.project_name}-http-listener"
  }
}

# Forward rule: only requests with the correct X-CloudFront-Secret header
resource "aws_lb_listener_rule" "cloudfront_verified" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 1

  condition {
    http_header {
      http_header_name = "X-CloudFront-Secret"
      values           = [random_password.cloudfront_secret.result]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }

  tags = {
    Name = "${var.project_name}-cf-verified-rule"
  }
}
