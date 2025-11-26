//! Simple Rust fixture for testing

/// Multiply two numbers
/// 
/// # Arguments
/// * `x` - First number
/// * `y` - Second number
/// 
/// # Returns
/// Product of x and y
pub fn multiply(x: i32, y: i32) -> i32 {
    // BUG: This should be multiplication, not addition
    x + y
}

/// Divide two numbers
/// 
/// # Arguments
/// * `x` - Numerator
/// * `y` - Denominator
/// 
/// # Returns
/// Quotient of x and y
/// 
/// # Panics
/// If y is zero
pub fn divide(x: i32, y: i32) -> i32 {
    if y == 0 {
        panic!("Cannot divide by zero");
    }
    x / y
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_multiply() {
        assert_eq!(multiply(2, 3), 6);
    }

    #[test]
    fn test_multiply_zero() {
        assert_eq!(multiply(5, 0), 0);
    }

    #[test]
    fn test_divide() {
        assert_eq!(divide(6, 2), 3);
    }

    #[test]
    #[should_panic(expected = "Cannot divide by zero")]
    fn test_divide_by_zero() {
        divide(5, 0);
    }
}

